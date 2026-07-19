/**
 * The authenticated session context (founder directive PHASE 2).
 *
 * `SessionContext` is the fully-resolved, SERVER-SIDE authorization context for a
 * single request. Every field is resolved server-side from the verified session
 * plus ΛFLO's own records — the browser NEVER authoritatively supplies
 * `organizationId`, `afloUserId`, `clientId`, `membershipId`, `role`, or
 * `permissions`. A request whose identity cannot be resolved is rejected
 * (fail closed).
 *
 * The Clerk-backed provider that produces this from a real session is a later,
 * credential-gated slice; this module defines the contract, the deterministic
 * builder both providers share, the bridge to the authorization engine, and the
 * fail-closed guard — all credential-free.
 */

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
  /** The permissions the role holds (a fresh set; safe to hold per request). */
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

  let role: Role;
  let activeOrganizationId: string | null = null;
  let activeMembershipId: string | null = null;
  let membershipStatus: MembershipStatus = "none";
  let linkedClientId: string | null = null;

  if (identity.isPlatformAdmin) {
    // Cross-tenant operator: no membership, no tenant binding.
    role = "platform_admin";
  } else if (membership) {
    role = roleFromMemberRole(membership.memberRole);
    activeOrganizationId = membership.organizationId;
    activeMembershipId = membership.membershipId;
    membershipStatus = membership.status;
  } else if (clientLink) {
    // A client's active tie to the org IS the client link (clients are not
    // organization_members rows). The link's presence + an active account is the
    // "active membership" the authorization engine's membership gate checks.
    role = "client";
    activeOrganizationId = clientLink.organizationId;
    linkedClientId = clientLink.clientId;
    membershipStatus = "active";
  } else {
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
