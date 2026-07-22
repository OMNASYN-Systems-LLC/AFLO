import { and, eq } from "drizzle-orm";
import type {
  IdentityProvider,
  MemberRole,
  PrincipalDirectory,
  PrincipalRecords,
} from "@aflo/auth";

/**
 * The DB `member_role` enum is wider than auth's staff-side `MemberRole`
 * (it also carries `client`/`partner_viewer` for historical seed rows). Only
 * the three staff-side roles resolve as a membership; anything else is treated
 * as NO membership (fail-closed — the user falls through to a client link).
 */
const STAFF_MEMBER_ROLES: readonly MemberRole[] = ["organization_owner", "organization_admin", "staff"];

function asMemberRole(role: string): MemberRole | null {
  return (STAFF_MEMBER_ROLES as readonly string[]).includes(role) ? (role as MemberRole) : null;
}
import { clientUserLinks, identityProviderAccounts, organizationMembers, users } from "../schema";
import type { ResolverDb } from "./resolver";

/**
 * Drizzle PrincipalDirectory on the RESOLVER connection (Workstream B5,
 * ADR-0037). Principal resolution happens BEFORE any org context exists — the
 * org is discovered FROM the membership/client link — so these reads run under
 * `aflo_auth_resolver` (BYPASSRLS + the migration-0008 SELECT grants), never
 * `withOrgContext`. Read-only: the directory resolves, it never writes.
 *
 * Fail-closed mappings:
 *   - No identity mapping, or a mapping pointing at a missing users row →
 *     null (an authenticated stranger stays unauthenticated to ΛFLO).
 *   - `users.is_active = false` → accountStatus "disabled" (the adapter's
 *     `buildSessionContext` then resolves NO session).
 *   - `users.sessions_invalidated_before` maps to the REQUIRED
 *     `sessionsInvalidatedBeforeIso` (ADR-0035 made the field non-optional so
 *     forgetting this mapping is a type error, not a revocation bypass).
 *   - Only an ACTIVE membership row resolves (`is_active = true`); a
 *     deactivated membership is treated as no membership at all, so the user
 *     falls through to a client link or to null — an accepted fail-closed
 *     under-grant (the boolean schema cannot distinguish pending/revoked;
 *     the richer MembershipStatus lands with the membership-lifecycle slice).
 *   - Only an ACTIVE client link resolves (`status = 'active'`).
 *   - `assignedClientIds` is null (assignment scoping OFF — matrix §8 default).
 */
export class DrizzlePrincipalDirectory implements PrincipalDirectory {
  private readonly db: ResolverDb;

  constructor(db: ResolverDb) {
    this.db = db;
  }

  async loadByProviderUser(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<PrincipalRecords | null> {
    const mapping = await this.db
      .select({ afloUserId: identityProviderAccounts.afloUserId })
      .from(identityProviderAccounts)
      .where(
        and(
          eq(identityProviderAccounts.provider, provider),
          eq(identityProviderAccounts.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    const afloUserId = mapping[0]?.afloUserId;
    if (!afloUserId) return null;

    const userRows = await this.db
      .select({
        id: users.id,
        isPlatformAdmin: users.isPlatformAdmin,
        isActive: users.isActive,
        sessionsInvalidatedBefore: users.sessionsInvalidatedBefore,
      })
      .from(users)
      .where(eq(users.id, afloUserId))
      .limit(1);
    const user = userRows[0];
    if (!user) return null; // dangling mapping — fail closed

    const memberRows = await this.db
      .select({
        id: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .where(and(eq(organizationMembers.userId, afloUserId), eq(organizationMembers.isActive, true)))
      .limit(1);
    const rawMember = memberRows[0] ?? null;
    const memberRole = rawMember ? asMemberRole(rawMember.role) : null;
    const member = rawMember && memberRole ? { ...rawMember, role: memberRole } : null;

    const linkRows = await this.db
      .select({
        clientId: clientUserLinks.clientId,
        organizationId: clientUserLinks.organizationId,
      })
      .from(clientUserLinks)
      .where(and(eq(clientUserLinks.userId, afloUserId), eq(clientUserLinks.status, "active")))
      .limit(1);
    const link = linkRows[0] ?? null;

    return {
      identity: {
        afloUserId,
        clerkUserId: providerUserId,
        accountStatus: user.isActive ? "active" : "disabled",
        isPlatformAdmin: user.isPlatformAdmin,
        sessionsInvalidatedBeforeIso: user.sessionsInvalidatedBefore?.toISOString() ?? null,
      },
      membership: member
        ? {
            membershipId: member.id,
            organizationId: member.organizationId,
            memberRole: member.role,
            status: "active",
          }
        : null,
      clientLink: link ? { clientId: link.clientId, organizationId: link.organizationId } : null,
      assignedClientIds: null,
    };
  }
}
