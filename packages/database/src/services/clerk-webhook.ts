import { createHash } from "node:crypto";
import type {
  IdentityAccountRepository,
  SessionRevocationRepository,
  WebhookEventRepository,
} from "@aflo/auth";
import { WebhookVerificationError, type VerifiedWebhook, type WebhookHeaders } from "@aflo/auth/webhook";

/**
 * Clerk webhook processing service (Workstream B4, ADR-0039) — the
 * credential-free core behind `POST /api/webhooks/clerk`. Everything
 * environment-shaped is INJECTED: the route composes a pre-bound verifier
 * (closing over `CLERK_WEBHOOK_SECRET`) and the resolver-path repositories;
 * tests inject fakes/stubs. Order of operations is the security contract:
 *
 *   1. VERIFY FIRST. An unverified payload is never persisted — not even a
 *      digest. Verification failures → 401 with the stable reason code.
 *   2. RECORD the receipt idempotently on `(provider, svix id)` with a sha256
 *      PAYLOAD DIGEST only (the raw payload is never stored — ADR-0026).
 *      A redelivery of an already-PROCESSED event is a 200 no-op (the
 *      at-most-once-success guard); a redelivery of a previously FAILED (or
 *      received-but-unfinished) event is RE-PROCESSED — failure must stay
 *      retryable or Svix redelivery is useless.
 *   3. DISPATCH by event type, then markProcessed / markFailed(errorCode).
 *
 * Dispatch semantics (deliberately narrow — Clerk is the IDENTITY authority,
 * never the org/membership/user-record authority):
 *   - `user.deleted` → if the identity maps to an ΛFLO user, revoke ALL that
 *     user's sessions (a provider-side deletion must fail closed immediately;
 *     the users-row lifecycle is ΛFLO's own, handled by staff flows).
 *   - `user.created`/`user.updated` → recorded processed, NO writes: ΛFLO
 *     users are provisioned through the INVITATION flow (identity-claiming
 *     invariant, ADR-0022) — a webhook must never create or mutate user
 *     records. Profile-sync, if ever wanted, is a founder-gated later slice.
 *   - `organizationMembership.*` / `organization.*` → recorded processed, NO
 *     writes: membership authority is ΛFLO's `organization_members`
 *     (AUTHORIZATION_MATRIX), not Clerk organizations.
 *   - unhandled types → recorded processed (ignored, not an error).
 */

export interface ClerkWebhookDeps {
  /**
   * Pre-bound verifier (secret + clock closed over by the composition root).
   * MUST throw `WebhookVerificationError` on any failure.
   */
  verify: (input: { payload: string; headers: WebhookHeaders }) => VerifiedWebhook;
  webhookEvents: WebhookEventRepository;
  identityAccounts: IdentityAccountRepository;
  sessionRevocations: SessionRevocationRepository;
  now: () => Date;
}

export interface ClerkWebhookRequest {
  /** The RAW request body, exactly as received (the signature is over raw bytes). */
  payload: string;
  headers: WebhookHeaders;
}

export interface ClerkWebhookResult {
  status: number;
  body: {
    ok: boolean;
    outcome:
      | "verification_failed"
      | "duplicate"
      | "processed"
      | "ignored"
      | "processing_failed";
    /** Stable machine-readable detail (never a secret, never payload content). */
    detail?: string;
  };
}

export async function handleClerkWebhook(
  deps: ClerkWebhookDeps,
  request: ClerkWebhookRequest,
): Promise<ClerkWebhookResult> {
  // 1. Verify FIRST — unverified payloads are never persisted in any form.
  let verified: VerifiedWebhook;
  try {
    verified = deps.verify({ payload: request.payload, headers: request.headers });
  } catch (err) {
    if (err instanceof WebhookVerificationError) {
      return { status: 401, body: { ok: false, outcome: "verification_failed", detail: err.reason } };
    }
    throw err;
  }

  const now = deps.now();
  const eventType = verified.event.type === "unhandled" ? verified.event.rawType || "unknown" : verified.event.type;
  const payloadDigest = createHash("sha256").update(request.payload, "utf8").digest("hex");

  // 2. Idempotent receipt — digest only, keyed on the Svix id.
  const receipt = await deps.webhookEvents.recordReceipt("clerk", verified.id, eventType, payloadDigest, now);
  if (!receipt.isNew && receipt.record.status === "processed") {
    // Already successfully processed — the at-most-once-success no-op.
    return { status: 200, body: { ok: true, outcome: "duplicate" } };
  }

  // 3. Dispatch, then processed/failed. Failures stay retryable via redelivery.
  //
  // CONCURRENCY NOTE (claim-lock deliberately absent): two concurrent
  // deliveries of the same Svix id can BOTH reach dispatch (A inserts, B reads
  // status "received"). That is safe TODAY because every handler is
  // idempotent — revoke is an insert whose read side is existence-based, and
  // everything else is a no-op. Before adding any NON-idempotent handler, a
  // claim step (UPDATE … SET status='processing' WHERE status IN
  // ('received','failed') RETURNING) MUST land first.
  try {
    const outcome = await dispatch(deps, verified, now);
    await deps.webhookEvents.markProcessed(receipt.record.id, deps.now());
    return { status: 200, body: { ok: true, outcome: outcome.kind, detail: outcome.detail } };
  } catch (err) {
    const errorCode = err instanceof Error ? err.name : "unknown_error";
    await deps.webhookEvents.markFailed(receipt.record.id, deps.now(), errorCode);
    return { status: 500, body: { ok: false, outcome: "processing_failed", detail: errorCode } };
  }
}

async function dispatch(
  deps: ClerkWebhookDeps,
  verified: VerifiedWebhook,
  now: Date,
): Promise<{ kind: "processed" | "ignored"; detail: string }> {
  const event = verified.event;
  if (event.type === "unhandled") return { kind: "ignored", detail: "unhandled_type" };

  switch (event.type) {
    case "user.deleted": {
      const clerkUserId = typeof event.data.id === "string" ? event.data.id : "";
      if (!clerkUserId) {
        // Clerk ALWAYS sends data.id on user.deleted — a verified deletion
        // without one means something upstream is broken. Fail the event
        // (markFailed + 500) so the anomaly surfaces in the Svix dashboard
        // instead of being buried as processed. Retries won't fix an immutable
        // payload; the alerting value is the point.
        const err = new Error("verified user.deleted event carried no user id");
        err.name = "MalformedUserDeletedEvent";
        throw err;
      }
      const mapping = await deps.identityAccounts.findByProvider("clerk", clerkUserId);
      if (!mapping) return { kind: "ignored", detail: "unmapped_identity" };
      // Provider-side deletion → fail closed NOW: revoke every session.
      await deps.sessionRevocations.revoke(
        {
          userId: mapping.afloUserId,
          providerSessionIdDigest: null, // all sessions
          reasonCode: "provider_user_deleted",
          revokedByUserId: null, // system-initiated
        },
        now,
      );
      return { kind: "processed", detail: "sessions_revoked" };
    }
    case "user.created":
    case "user.updated":
      // ΛFLO users are provisioned via the invitation flow (identity-claiming
      // invariant) — the webhook records but never creates/mutates user rows.
      return { kind: "ignored", detail: "user_provisioning_via_invitation" };
    case "organization.created":
    case "organization.updated":
    case "organizationMembership.created":
    case "organizationMembership.updated":
    case "organizationMembership.deleted":
      // Membership/org authority is ΛFLO's own organization_members.
      return { kind: "ignored", detail: "not_authoritative" };
  }
}
