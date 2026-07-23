import {
  authorize,
  InvitationError,
  isRole,
  issueInvitation,
  normalizeEmail,
  toPrincipal,
  type InvitationRepository,
  type SessionContext,
  type SessionContextProvider,
} from "@aflo/auth";
import { ClientNotInOrganizationError } from "../repositories/invitation";
import type {
  AcceptInvitationByTokenInput,
  AcceptInvitationByTokenOutcome,
} from "./accept-invitation";

/**
 * Invitation issuance + acceptance route services (Workstream B6/B7,
 * ADR-0042) — the credential-free cores behind `POST /api/invitations` and
 * `POST /api/invitations/accept`, in the B4 pattern (ADR-0039): everything
 * environment-shaped is INJECTED (session provider, repositories, clock, id
 * and token generators, verified-email accessor), the route composes from env
 * and fails closed, and tests drive the services with stubs + PGlite.
 *
 * Security contract, in order:
 *
 *   RAW-TOKEN-ONCE (issuance). The raw invitation token appears EXACTLY ONCE —
 *   in the 201 response body of the issuing call. It is never persisted (only
 *   the sha256 digest reaches the repository, enforced by the domain type:
 *   `Invitation` carries `tokenHash` and cannot represent the raw token), never
 *   logged, and cannot be retrieved again. A lost token means issuing a new
 *   invitation. The `generateToken` dependency is injected so tests can pin a
 *   deterministic pair and prove digest-only persistence by dumping the row.
 *
 *   OWNER-ONLY ISSUANCE. Issuance is gated on `organization.manage_members`
 *   through the deterministic engine (`authorize(toPrincipal(ctx), …)`), which
 *   only `organization_owner` holds (AUTHORIZATION_MATRIX §4 footnote b:
 *   managing memberships/invitations is owner-reserved — Organization Admin
 *   and Staff read but never change; there is no invitation-specific
 *   permission token, and `organization.manage_members` IS the matrix's name
 *   for this capability). Client/partner principals are denied by the same
 *   gate. The issuing org is ALWAYS `ctx.activeOrganizationId` — never request
 *   input — so an invitation cannot be minted into a foreign tenant; a
 *   principal with no active org (including platform admin, whose
 *   invitation-management surface is the separate audited platform surface,
 *   not this tenant route) fails closed before the engine is even consulted.
 *
 *   SESSION-VERIFIED EMAIL (acceptance). The email compared against the
 *   invitation comes from the injected `verifiedEmail(ctx)` accessor, which
 *   the composition root binds to the VERIFIED Clerk session identity (the
 *   provider-verified primary email) — NEVER the request body. A caller cannot
 *   claim someone else's invitation by posting that person's address. When no
 *   verified email is available the accept fails closed (401).
 *
 *   ORACLE-UNIFORM NOT-FOUND (acceptance). `invalid_token` and
 *   `email_mismatch` return byte-identical 404 responses. An email-mismatch
 *   denial would otherwise confirm to the WRONG holder of a leaked/forwarded
 *   invite link that the token is live and worth phishing the right inbox
 *   for. Post-terminal states (`expired`, `already_accepted`, `already_bound`,
 *   `already_revoked`) keep distinct stable codes: those invitations can no
 *   longer be claimed by anyone, so confirming their state has no comparable
 *   value to an attacker and real invitees need the distinction to act
 *   (request a fresh invitation vs. contact staff).
 */

// ---------------------------------------------------------------------------
// Audit emission (matrix §7 row 1 — the ADR-0042 deferral, closed by ADR-0044)
// ---------------------------------------------------------------------------

/**
 * One membership-creation audit event (invitation issued / accepted). Ids and
 * codes ONLY — never emails, never tokens (raw or digest), never PII. The
 * production sink is `DrizzleAuditEventRepository` (org-scoped, RLS-enforced);
 * emission failure never fails the request (the state change already
 * committed) — it is surfaced via `onAuditFailure` as a logged secondary error.
 */
export interface InvitationAuditEvent {
  organizationId: string;
  actorMemberId: string | null;
  action: "invitation.issued" | "invitation.accepted";
  targetType: "invitation" | "organization_member" | "client_user_link";
  targetId: string;
  /** Compact JSON of identifiers/codes only. */
  detail: string | null;
  reasonCode: string | null;
  occurredAt: Date;
}

/** Optional in the type, REQUIRED in composition (both routes inject it). */
export interface InvitationAuditSink {
  record(event: InvitationAuditEvent): Promise<void>;
}

function defaultAuditFailureLog(error: unknown): void {
  console.error("[invitations] audit write failed (state change already committed)", error);
}

/** Emit, never throw: audit failure must not fail an already-committed change. */
async function emitInvitationAudit(
  sink: InvitationAuditSink | undefined,
  onAuditFailure: ((error: unknown) => void) | undefined,
  event: InvitationAuditEvent,
): Promise<void> {
  if (!sink) return;
  try {
    await sink.record(event);
  } catch (error) {
    (onAuditFailure ?? defaultAuditFailureLog)(error);
  }
}

// ---------------------------------------------------------------------------
// Issuance (B6)
// ---------------------------------------------------------------------------

/** The permission that gates invitation issuance (matrix §4 footnote b — owner-only). */
export const INVITATION_ISSUE_PERMISSION = "organization.manage_members" as const;

/** Default invitation validity window: 7 days (overridable via deps.ttlMs). */
export const DEFAULT_INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export interface IssueInvitationRouteDeps {
  sessionProvider: SessionContextProvider;
  invitations: InvitationRepository;
  now: () => Date;
  /** Server-issued invitation id (composition root: randomUUID). */
  newId: () => string;
  /**
   * Fresh raw-token/digest pair (composition root: `generateInvitationToken`
   * from `@aflo/auth/invitation-token`). Injected so tests are deterministic
   * and can prove only the digest persists.
   */
  generateToken: () => { token: string; tokenHash: string };
  /** Validity window in milliseconds; defaults to DEFAULT_INVITATION_TTL_MS. */
  ttlMs?: number;
  /** Matrix §7 audit sink — optional in the type, REQUIRED in composition. */
  auditSink?: InvitationAuditSink;
  /** Secondary-error channel for a failed audit write (default: console.error). */
  onAuditFailure?: (error: unknown) => void;
}

/** Unvalidated request-body fields — the service validates, the route only parses JSON. */
export interface IssueInvitationRouteInput {
  email?: unknown;
  intendedRole?: unknown;
  reservedClientId?: unknown;
}

export type IssueInvitationRouteResult =
  | {
      status: 201;
      body: {
        ok: true;
        invitationId: string;
        /** The raw token — returned HERE and nowhere else, ever (see module doc). */
        token: string;
        expiresAt: string;
      };
    }
  | { status: 400 | 401 | 403 | 409; body: { ok: false; error: string } };

function issueDenied(
  status: 400 | 401 | 403 | 409,
  error: string,
): IssueInvitationRouteResult {
  return { status, body: { ok: false, error } };
}

/** Postgres unique-violation (23505) across drizzle wrapper shapes (see invitation.ts). */
function isUniqueViolation(err: unknown): boolean {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (!candidate) continue;
    if ((candidate as { code?: string }).code === "23505") return true;
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    if (/duplicate key|unique constraint|23505/i.test(message)) return true;
  }
  return false;
}

export async function handleIssueInvitation(
  deps: IssueInvitationRouteDeps,
  input: IssueInvitationRouteInput,
): Promise<IssueInvitationRouteResult> {
  // 1. Resolved session or nothing (fail closed).
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return issueDenied(401, "unauthenticated");

  // 2. The issuing org is the SESSION's active org — never request input. No
  //    active org (platform admin included — see module doc) fails closed here.
  const organizationId = ctx.activeOrganizationId;
  if (!organizationId) return issueDenied(403, "no_active_membership");

  // 3. The deterministic engine decides — owner-only via
  //    `organization.manage_members` (client/staff/admin/partner all denied).
  const decision = authorize({
    principal: toPrincipal(ctx),
    permission: INVITATION_ISSUE_PERMISSION,
    resource: { organizationId },
  });
  if (!decision.allowed) {
    return issueDenied(decision.reason === "unauthenticated" ? 401 : 403, decision.reason);
  }

  // 4. Validate input AFTER authorization (validation detail is not leaked to
  //    unauthorized callers). Email shape check is deliberately minimal — the
  //    kernel normalizes; deliverability is the email slice's concern.
  if (typeof input.email !== "string" || !normalizeEmail(input.email).includes("@")) {
    return issueDenied(400, "invalid_email");
  }
  if (typeof input.intendedRole !== "string" || !isRole(input.intendedRole)) {
    return issueDenied(400, "invalid_role");
  }
  const reservedClientId = input.reservedClientId ?? null;
  if (reservedClientId !== null && typeof reservedClientId !== "string") {
    return issueDenied(400, "invalid_reserved_client_id");
  }

  // 5. The invitation kernel enforces the construction invariants: an invitable
  //    role only (platform_admin / partner_viewer can never be minted), and a
  //    client invitation MUST reserve a client while any other role MUST NOT.
  const now = deps.now();
  const pair = deps.generateToken();
  let invitation;
  try {
    invitation = issueInvitation({
      id: deps.newId(),
      organizationId,
      email: input.email,
      intendedRole: input.intendedRole,
      reservedClientId,
      tokenHash: pair.tokenHash,
      createdAtIso: now.toISOString(),
      expiresAtIso: new Date(now.getTime() + (deps.ttlMs ?? DEFAULT_INVITATION_TTL_MS)).toISOString(),
    });
  } catch (err) {
    if (err instanceof InvitationError) return issueDenied(400, err.reason);
    throw err;
  }

  // 6. Persist under the session org (RLS-scoped via the repository); only the
  //    digest crosses this boundary. The issuing member is recorded for audit.
  let stored;
  try {
    stored = await deps.invitations.issue(organizationId, invitation, ctx.activeMembershipId, now);
  } catch (err) {
    if (err instanceof ClientNotInOrganizationError) {
      // The reserved client is not visible in the session org (foreign or
      // unknown id) — indistinguishable by design (RLS), stable either way.
      return issueDenied(400, "client_not_in_organization");
    }
    if (isUniqueViolation(err)) {
      // At most one PENDING invitation per (org, email) — surface as conflict.
      return issueDenied(409, "duplicate_pending_invitation");
    }
    throw err;
  }

  // 7. Matrix §7 row 1: the issuance is audited — ids/role only, NEVER the
  //    email and NEVER the token in any form. A failed write cannot unwind the
  //    committed issuance; it logs as a secondary error.
  await emitInvitationAudit(deps.auditSink, deps.onAuditFailure, {
    organizationId,
    actorMemberId: ctx.activeMembershipId,
    action: "invitation.issued",
    targetType: "invitation",
    targetId: stored.id,
    detail: JSON.stringify({
      afloUserId: ctx.afloUserId,
      intendedRole: input.intendedRole,
      reservedClientId,
    }),
    reasonCode: null,
    occurredAt: now,
  });

  // 8. The ONE appearance of the raw token (see module doc).
  return {
    status: 201,
    body: { ok: true, invitationId: stored.id, token: pair.token, expiresAt: stored.expiresAtIso },
  };
}

// ---------------------------------------------------------------------------
// Acceptance (B7)
// ---------------------------------------------------------------------------

export interface AcceptInvitationRouteDeps {
  sessionProvider: SessionContextProvider;
  /** The pre-bound `acceptInvitationByToken` (resolver read → org-scoped write). */
  acceptInvitation: (input: AcceptInvitationByTokenInput) => Promise<AcceptInvitationByTokenOutcome>;
  /**
   * The accepter's VERIFIED email. `SessionContext` deliberately carries no
   * email, so the composition root injects this accessor bound to the verified
   * Clerk session identity (provider-verified primary email) — NEVER the
   * request body. Null (no verified email available) fails closed as 401.
   */
  verifiedEmail: (ctx: SessionContext) => Promise<string | null>;
  now: () => Date;
  /** Server-issued id for a new staff membership (composition root: randomUUID). */
  newMembershipId: () => string;
  /** Matrix §7 audit sink — optional in the type, REQUIRED in composition. */
  auditSink?: InvitationAuditSink;
  /** Secondary-error channel for a failed audit write (default: console.error). */
  onAuditFailure?: (error: unknown) => void;
}

export interface AcceptInvitationRouteInput {
  token?: unknown;
}

export type AcceptInvitationRouteResult =
  | {
      status: 200;
      body: { ok: true; kind: "membership" | "client_link"; organizationId: string };
    }
  | { status: 400 | 401 | 404 | 409 | 410; body: { ok: false; error: string } };

/** The one uniform body for "this token resolves to nothing you may learn about". */
const UNIFORM_NOT_FOUND = "invitation_not_found";

/**
 * Map an accept denial to its stable HTTP surface. `invalid_token` and
 * `email_mismatch` are byte-identical 404s (the anti-oracle rule — module doc);
 * post-terminal states keep distinct codes; anything else (kernel/membership
 * denials that cannot normally reach this path) defaults to a stable 409 —
 * fail closed, never a 200 and never a leak of internals.
 */
function acceptDenial(
  reason: string,
): { status: 404 | 409 | 410; body: { ok: false; error: string } } {
  switch (reason) {
    case "invalid_token":
    case "email_mismatch":
      return { status: 404, body: { ok: false, error: UNIFORM_NOT_FOUND } };
    case "expired":
    case "already_expired":
    case "already_revoked":
      return { status: 410, body: { ok: false, error: reason } };
    default:
      // already_accepted, already_bound, and any unexpected denial.
      return { status: 409, body: { ok: false, error: reason } };
  }
}

export async function handleAcceptInvitation(
  deps: AcceptInvitationRouteDeps,
  input: AcceptInvitationRouteInput,
): Promise<AcceptInvitationRouteResult> {
  // 1. The accepter must hold a resolved, verified session (Clerk sign-in/up
  //    happens BEFORE accepting; the identity-claiming invariant then binds the
  //    invitation's reserved org/client to that identity — never the reverse).
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return { status: 401, body: { ok: false, error: "unauthenticated" } };

  // 2. A malformed request (no token string) is a 400 — it reveals nothing.
  if (typeof input.token !== "string" || input.token.trim().length === 0) {
    return { status: 400, body: { ok: false, error: "missing_token" } };
  }

  // 3. The verified session email, or fail closed. Never the request body.
  const email = await deps.verifiedEmail(ctx);
  if (typeof email !== "string" || email.trim().length === 0) {
    return { status: 401, body: { ok: false, error: "no_verified_email" } };
  }

  // 4. The PGlite-proven core: resolver lookup, constant-time token check,
  //    deterministic kernel, atomic claim + link/membership write.
  const outcome = await deps.acceptInvitation({
    rawToken: input.token,
    afloUserId: ctx.afloUserId,
    email,
    now: deps.now(),
    newMembershipId: deps.newMembershipId(),
  });

  if (!outcome.ok) return acceptDenial(outcome.reason);

  // 5. Matrix §7 row 1: the membership/link creation is audited — the target
  //    is the row the acceptance created; ids only, never the email/token.
  await emitInvitationAudit(deps.auditSink, deps.onAuditFailure, {
    organizationId: outcome.organizationId,
    actorMemberId: outcome.kind === "membership" ? outcome.membershipId : null,
    action: "invitation.accepted",
    targetType: outcome.kind === "membership" ? "organization_member" : "client_user_link",
    targetId: outcome.kind === "membership" ? outcome.membershipId : outcome.linkId,
    detail: JSON.stringify(
      outcome.kind === "membership"
        ? { afloUserId: ctx.afloUserId, kind: outcome.kind }
        : { afloUserId: ctx.afloUserId, kind: outcome.kind, clientId: outcome.clientId },
    ),
    reasonCode: null,
    occurredAt: deps.now(),
  });

  return {
    status: 200,
    body: { ok: true, kind: outcome.kind, organizationId: outcome.organizationId },
  };
}
