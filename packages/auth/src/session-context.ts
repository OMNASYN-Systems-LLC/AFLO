/**
 * The authenticated session context (founder directive PHASE 2).
 *
 * `SessionContext` is the fully-resolved, SERVER-SIDE authorization context for a
 * single request. Every field is resolved server-side from the verified session
 * plus ΛFLO's own records — the browser NEVER authoritatively supplies
 * `organizationId`, `afloUserId`, `clientId`, `membershipId`, `role`,
 * `permissions`, or `sessionIssuedAtIso` (the last must come from the verified
 * session, or a future-dated value would bypass revocation). A request whose
 * identity cannot be resolved is rejected (fail closed).
 *
 * The Clerk-backed provider that produces this from a real session is a later,
 * credential-gated slice; this module defines the contract, the deterministic
 * builder both providers share, the bridge to the authorization engine, and the
 * fail-closed guard — all credential-free.
 */

import { isSessionRevoked } from "./account";
import type { AccountStatus, MembershipStatus, Principal } from "./authorization";
import type { AfloIdentity, ClientLink, Membership } from "./identity";
import type { Permission } from "./permissions";
import { permissionsForRole } from "./policies";
import { roleFromMemberRole, type Role } from "./roles";

export interface SessionContext {
  sessionId: string;
  clerkUserId: string;
  afloUserId: string;
  role: Role;
  /**
   * INFORMATIONAL / DISPLAY ONLY — never an authorization source. The enforcement
   * path is `authorize(toPrincipal(ctx), …)`, which re-derives from `role` and
   * applies the tenant/ownership/assignment/consent/account gates. A call site
   * that gates on `ctx.permissions.has(...)` would grant on role alone and bypass
   * every contextual gate (tenant isolation included). Use it only to render UI
   * (e.g. hide a button), never to decide access.
   */
  permissions: ReadonlySet<Permission>;
  accountStatus: AccountStatus;
  /** The tenant being acted within. Null for platform admin (no membership). */
  activeOrganizationId: string | null;
  activeMembershipId: string | null;
  membershipStatus: MembershipStatus;
  /** The linked client record — set only for the client role. */
  linkedClientId: string | null;
  /** Staff assignment scoping: non-null enables it; null = staff see all (§8). */
  assignedClientIds: readonly string[] | null;
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

/** Server-only provider that resolves the current request's session context. */
export interface SessionContextProvider {
  /** Null = unauthenticated or unresolved identity (caller must fail closed). */
  resolve(): Promise<SessionContext | null>;
}

export interface SessionContextInput {
  sessionId: string;
  identity: AfloIdentity;
  /** The user's active staff membership, if any. */
  membership?: Membership | null;
  /** The user's client-account link, if any. */
  clientLink?: ClientLink | null;
  /** Optional staff assignment scoping (null/omitted = scoping off). */
  assignedClientIds?: readonly string[] | null;
  /** When the current session was issued — checked against the revocation cutoff. */
  sessionIssuedAtIso?: string;
}

/**
 * Deterministically resolve a SessionContext from verified ΛFLO records.
 *
 * Role precedence (highest privilege of authority wins, most-authoritative
 * source first): the verified platform-admin flag → an active staff membership
 * row → a client link. Returns null when NONE of these resolves a role (the user
 * has no tie to any tenant) — the caller treats null as unauthenticated.
 */
export function buildSessionContext(input: SessionContextInput): SessionContext | null {
  const { sessionId, identity, membership, clientLink } = input;

  // Fail closed at the session layer, not only at the engine: a degenerate
  // identity (no ΛFLO user) is never a resolved session.
  if (!isNonEmpty(identity.afloUserId)) return null;

  // A disabled account gets NO session at all (not merely an authorize() denial).
  if (identity.accountStatus === "disabled") return null;

  // Session revocation: when a cutoff is in effect, a session issued before it no
  // longer resolves. Fails CLOSED — if a cutoff is set but the session's issued-at
  // is unknown, we cannot prove the session post-dates the cutoff, so we reject.
  // (Reactivate-after-disable and sign-out-everywhere leave status=active with a
  // live cutoff, so this — not the disabled gate — is the only control there.)
  const revocationCutoff = identity.sessionsInvalidatedBeforeIso;
  if (revocationCutoff !== null) {
    if (input.sessionIssuedAtIso === undefined) return null;
    if (isSessionRevoked(input.sessionIssuedAtIso, revocationCutoff)) return null;
  }

  let role: Role;
  let activeOrganizationId: string | null = null;
  let activeMembershipId: string | null = null;
  let membershipStatus: MembershipStatus = "none";
  let linkedClientId: string | null = null;

  if (identity.isPlatformAdmin) {
    // Cross-tenant operator: no membership, no tenant binding.
    role = "platform_admin";
  } else if (membership) {
    // A membership row with no organization is not a resolvable tenant tie.
    if (!isNonEmpty(membership.organizationId)) return null;
    role = roleFromMemberRole(membership.memberRole);
    activeOrganizationId = membership.organizationId;
    activeMembershipId = membership.membershipId;
    membershipStatus = membership.status;
  } else if (clientLink) {
    // A client's active tie to the org IS the client link (clients are not
    // organization_members rows). The link's presence + an active account is the
    // "active membership" the authorization engine's membership gate checks.
    // A link missing its client or org is not a resolvable identity.
    if (!isNonEmpty(clientLink.clientId) || !isNonEmpty(clientLink.organizationId)) return null;
    role = "client";
    activeOrganizationId = clientLink.organizationId;
    linkedClientId = clientLink.clientId;
    membershipStatus = "active";
  } else {
    // A user with no platform flag, no membership, and no client link (or — see
    // above — a revoked/pending staff member with no separately resolvable role)
    // has no tie to any tenant and is unauthenticated. Precedence is by authority
    // source (platform flag > membership > client link), so a user who is BOTH a
    // (revoked) staff member and an active client resolves as revoked staff and is
    // denied — an accepted fail-closed under-grant for the V1 single-role model.
    return null;
  }

  return {
    sessionId,
    clerkUserId: identity.clerkUserId,
    afloUserId: identity.afloUserId,
    role,
    permissions: permissionsForRole(role),
    accountStatus: identity.accountStatus,
    activeOrganizationId,
    activeMembershipId,
    membershipStatus,
    linkedClientId,
    assignedClientIds: input.assignedClientIds ?? null,
  };
}

/** Bridge a resolved SessionContext to the authorization-engine Principal. */
export function toPrincipal(ctx: SessionContext): Principal {
  return {
    afloUserId: ctx.afloUserId,
    role: ctx.role,
    accountStatus: ctx.accountStatus,
    activeOrganizationId: ctx.activeOrganizationId,
    membershipStatus: ctx.membershipStatus,
    linkedClientId: ctx.linkedClientId,
    assignedClientIds: ctx.assignedClientIds,
  };
}

/** Thrown when a request has no resolvable session; handlers map it to 401/redirect. */
export class UnresolvedSessionError extends Error {
  constructor() {
    super("unauthorized: no resolved session context");
    this.name = "UnresolvedSessionError";
  }
}

/** Fail closed: reject an unauthenticated / unresolved session. */
export async function requireSessionContext(
  provider: SessionContextProvider,
): Promise<SessionContext> {
  const ctx = await provider.resolve();
  if (!ctx) throw new UnresolvedSessionError();
  return ctx;
}
