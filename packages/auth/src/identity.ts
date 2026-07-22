/**
 * ΛFLO's OWN identity/membership value types (founder directive PHASE 2).
 *
 * These are domain records ΛFLO controls — resolved from `users`,
 * `organization_members`, and the client-account link. They are deliberately NOT
 * the Clerk SDK's objects: Clerk owns authentication (credentials, sessions,
 * verification); ΛFLO owns organization, membership, role, client link, account
 * status, consent, and audit. The Clerk id is carried as an opaque reference
 * (`clerkUserId`), never as the authority for anything but "who authenticated."
 */

import type { AccountStatus, MembershipStatus } from "./authorization";
import type { MemberRole } from "./roles";

/**
 * The verified ΛFLO user. `isPlatformAdmin` MUST come only from the
 * `users.is_platform_admin` column — never a Clerk claim or client-supplied
 * value — because the platform-admin role skips the tenant gate (ADR-0018).
 */
export interface AfloIdentity {
  afloUserId: string;
  clerkUserId: string;
  accountStatus: AccountStatus;
  isPlatformAdmin: boolean;
  /**
   * The account's session-revocation cutoff (account.ts): a session issued before
   * this instant no longer resolves. Null means nothing is revoked. REQUIRED
   * (not optional) so a principal loader that forgets to map the
   * `users.sessions_invalidated_before` column is a TYPE ERROR, not a silent
   * revocation bypass — the fail-closed guarantee rests on this field arriving.
   */
  sessionsInvalidatedBeforeIso: string | null;
}

/** One `organization_members` row — a user's staff-role tie to an organization. */
export interface Membership {
  membershipId: string;
  organizationId: string;
  memberRole: MemberRole;
  /** Row status; the `none` sentinel of MembershipStatus never appears on a row. */
  status: MembershipStatus;
}

/** Links a user to the client record they ARE (client role only). */
export interface ClientLink {
  clientId: string;
  organizationId: string;
}
