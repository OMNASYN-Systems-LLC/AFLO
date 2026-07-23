import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type {
  IdentityAccountRepository,
  IdentityProviderAccountRecord,
  RecordedWebhookEvent,
  RevokeSessionsInput,
  SessionRevocationRepository,
  WebhookEventRepository,
  WebhookReceiptResult,
} from "@aflo/auth";
import { WebhookVerificationError, type VerifiedWebhook } from "@aflo/auth/webhook";
import { handleClerkWebhook, type ClerkWebhookDeps } from "../src/services/clerk-webhook";

/**
 * Workstream B4 — the Clerk webhook service, proven credential-free with an
 * injected verifier and recording stubs. The order-of-operations contract:
 * verify FIRST (unverified payloads never persisted), idempotent digest-only
 * receipt, retryable failures, narrow authority-respecting dispatch.
 */

const NOW = new Date("2026-07-22T12:00:00.000Z");

class StubWebhookEvents implements WebhookEventRepository {
  receipts = new Map<string, RecordedWebhookEvent>();
  digests: string[] = [];
  processed: string[] = [];
  failed: { id: string; errorCode: string }[] = [];

  async recordReceipt(
    provider: "clerk",
    providerEventId: string,
    eventType: string,
    payloadDigest: string,
  ): Promise<WebhookReceiptResult> {
    this.digests.push(payloadDigest);
    const existing = this.receipts.get(providerEventId);
    if (existing) return { isNew: false, record: existing };
    const record: RecordedWebhookEvent = {
      id: `rec-${providerEventId}`,
      provider,
      providerEventId,
      eventType,
      status: "received",
      attempts: 0,
    };
    this.receipts.set(providerEventId, record);
    return { isNew: true, record };
  }
  async markProcessed(id: string): Promise<void> {
    this.processed.push(id);
    for (const r of this.receipts.values()) if (r.id === id) r.status = "processed";
  }
  async markFailed(id: string, _now: Date, errorCode: string): Promise<void> {
    this.failed.push({ id, errorCode });
    for (const r of this.receipts.values()) if (r.id === id) r.status = "failed";
  }
}

class StubIdentityAccounts implements IdentityAccountRepository {
  mappings = new Map<string, string>(); // clerkUserId -> afloUserId
  async findByProvider(_p: "clerk", providerUserId: string): Promise<IdentityProviderAccountRecord | null> {
    const afloUserId = this.mappings.get(providerUserId);
    return afloUserId ? { id: "m1", provider: "clerk", providerUserId, afloUserId } : null;
  }
  async link(): Promise<IdentityProviderAccountRecord> {
    throw new Error("not used");
  }
}

class StubRevocations implements SessionRevocationRepository {
  revoked: RevokeSessionsInput[] = [];
  async revoke(input: RevokeSessionsInput): Promise<void> {
    this.revoked.push(input);
  }
  async isSessionRevoked(): Promise<boolean> {
    return false;
  }
}

function verifiedEvent(id: string, type: string, data: Record<string, unknown> = {}): VerifiedWebhook {
  return {
    id,
    timestamp: 1784736000,
    event:
      type === "unhandled"
        ? { type: "unhandled", rawType: "session.pinged", data }
        : { type: type as never, data },
  };
}

function setup(verify: ClerkWebhookDeps["verify"]) {
  const webhookEvents = new StubWebhookEvents();
  const identityAccounts = new StubIdentityAccounts();
  const sessionRevocations = new StubRevocations();
  const deps: ClerkWebhookDeps = { verify, webhookEvents, identityAccounts, sessionRevocations, now: () => NOW };
  return { deps, webhookEvents, identityAccounts, sessionRevocations };
}

const REQ = { payload: '{"type":"user.updated","data":{}}', headers: {} };

describe("handleClerkWebhook — verify-first, digest-only, at-most-once-success", () => {
  it("returns 401 on verification failure and persists NOTHING (not even a digest)", async () => {
    const { deps, webhookEvents } = setup(() => {
      throw new WebhookVerificationError("signature_mismatch");
    });
    const result = await handleClerkWebhook(deps, REQ);
    expect(result).toEqual({
      status: 401,
      body: { ok: false, outcome: "verification_failed", detail: "signature_mismatch" },
    });
    expect(webhookEvents.digests).toEqual([]);
    expect(webhookEvents.receipts.size).toBe(0);
  });

  it("records the receipt with the sha256 payload digest — never the raw payload", async () => {
    const { deps, webhookEvents } = setup(() => verifiedEvent("evt_1", "user.updated"));
    await handleClerkWebhook(deps, REQ);
    const expectedDigest = createHash("sha256").update(REQ.payload, "utf8").digest("hex");
    expect(webhookEvents.digests).toEqual([expectedDigest]);
    expect(webhookEvents.receipts.get("evt_1")?.status).toBe("processed");
  });

  it("a redelivery of a PROCESSED event is a 200 no-op (at-most-once success)", async () => {
    const { deps, webhookEvents } = setup(() => verifiedEvent("evt_1", "user.updated"));
    await handleClerkWebhook(deps, REQ);
    const again = await handleClerkWebhook(deps, REQ);
    expect(again.body.outcome).toBe("duplicate");
    expect(webhookEvents.processed).toHaveLength(1); // not re-processed
  });

  it("a redelivery of a FAILED event is RE-PROCESSED (failures stay retryable)", async () => {
    const { deps, webhookEvents, identityAccounts } = setup(() =>
      verifiedEvent("evt_2", "user.deleted", { id: "ck_x" }),
    );
    identityAccounts.mappings.set("ck_x", "user-x");
    // First delivery: make revoke throw → markFailed + 500.
    const boom = new Error("db down");
    boom.name = "DbDownError";
    const originalRevoke = deps.sessionRevocations.revoke.bind(deps.sessionRevocations);
    deps.sessionRevocations.revoke = async () => {
      throw boom;
    };
    const first = await handleClerkWebhook(deps, REQ);
    expect(first.status).toBe(500);
    expect(first.body.outcome).toBe("processing_failed");
    expect(webhookEvents.failed).toEqual([{ id: "rec-evt_2", errorCode: "DbDownError" }]);
    // Redelivery: revoke works now → re-processed, not a duplicate no-op.
    deps.sessionRevocations.revoke = originalRevoke;
    const second = await handleClerkWebhook(deps, REQ);
    expect(second.status).toBe(200);
    expect(second.body.outcome).toBe("processed");
    expect(webhookEvents.receipts.get("evt_2")?.status).toBe("processed");
  });
});

describe("handleClerkWebhook — authority-respecting dispatch", () => {
  it("user.deleted with a mapped identity revokes ALL the user's sessions", async () => {
    const { deps, sessionRevocations, identityAccounts } = setup(() =>
      verifiedEvent("evt_3", "user.deleted", { id: "ck_gone" }),
    );
    identityAccounts.mappings.set("ck_gone", "user-gone");
    const result = await handleClerkWebhook(deps, REQ);
    expect(result.body).toMatchObject({ outcome: "processed", detail: "sessions_revoked" });
    expect(sessionRevocations.revoked).toEqual([
      {
        userId: "user-gone",
        providerSessionIdDigest: null,
        reasonCode: "provider_user_deleted",
        revokedByUserId: null,
      },
    ]);
  });

  it("a VERIFIED user.deleted with no user id is marked FAILED (anomaly surfaces, not buried)", async () => {
    const { deps, webhookEvents, sessionRevocations } = setup(() => verifiedEvent("evt_noid", "user.deleted", {}));
    const result = await handleClerkWebhook(deps, REQ);
    expect(result.status).toBe(500);
    expect(result.body).toMatchObject({ outcome: "processing_failed", detail: "MalformedUserDeletedEvent" });
    expect(webhookEvents.failed).toEqual([{ id: "rec-evt_noid", errorCode: "MalformedUserDeletedEvent" }]);
    expect(sessionRevocations.revoked).toEqual([]);
  });

  it("user.deleted for an unmapped identity is recorded and ignored", async () => {
    const { deps, sessionRevocations } = setup(() => verifiedEvent("evt_4", "user.deleted", { id: "ck_stranger" }));
    const result = await handleClerkWebhook(deps, REQ);
    expect(result.body).toMatchObject({ outcome: "ignored", detail: "unmapped_identity" });
    expect(sessionRevocations.revoked).toEqual([]);
  });

  it("user.created/updated never write — provisioning is the invitation flow's job", async () => {
    for (const type of ["user.created", "user.updated"]) {
      const { deps, webhookEvents } = setup(() => verifiedEvent(`evt_${type}`, type, { id: "ck_new" }));
      const result = await handleClerkWebhook(deps, REQ);
      expect(result.body).toMatchObject({ outcome: "ignored", detail: "user_provisioning_via_invitation" });
      expect(webhookEvents.receipts.get(`evt_${type}`)?.status).toBe("processed");
    }
  });

  it("organization/membership events are recorded but never authoritative", async () => {
    const { deps } = setup(() => verifiedEvent("evt_5", "organizationMembership.created", {}));
    const result = await handleClerkWebhook(deps, REQ);
    expect(result.body).toMatchObject({ outcome: "ignored", detail: "not_authoritative" });
  });

  it("unhandled event types are recorded processed, not errors", async () => {
    const { deps, webhookEvents } = setup(() => verifiedEvent("evt_6", "unhandled"));
    const result = await handleClerkWebhook(deps, REQ);
    expect(result.body).toMatchObject({ outcome: "ignored", detail: "unhandled_type" });
    expect(webhookEvents.receipts.get("evt_6")?.eventType).toBe("session.pinged");
  });
});
