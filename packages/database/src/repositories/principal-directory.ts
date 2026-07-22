import { and, desc, eq, inArray } from "drizzle-orm";
import type {
  IdentityProvider,
  MemberRole,
  Membership,
  PrincipalDirectory,
  PrincipalRecords,
} from "@aflo/auth";
import { clientUserLinks, identityProviderAccounts, organizationMembers, users } from "../schema";
import type { ResolverDb } from "./resolver";

/**
 * The DB `member_role` enum is wider than auth's staff-side `MemberRole`
 * (it also carries `client`/`partner_viewer` for historical seed rows). The
 * membership queries filter to these three IN SQL (`role IN (...)`), so a
 * non-staff row can never consume a LIMIT slot or shadow a staff membership.
 */
const STAFF_MEMBER_ROLES: readonly MemberRole[] = ["organization_owner", "organization_admin", "staff"];

/** Sentinel for "the binding is ambiguous — fail closed" (distinct from "none"). */
const AMBIGUOUS = Symbol("ambiguous-principal-binding");

/**
 * Drizzle PrincipalDirectory on the RESOLVER connection (Workstream B5,
 * ADR-0037). Principal resolution happens BEFORE any org context exists — the
 * org is discovered FROM the membership/client link — so these reads run under
 * `aflo_auth_resolver` (BYPASSRLS + the migration-0008 SELECT grants), never
 * `withOrgContext`. Read-only: the directory resolves, it never writes.
 *
 * Selection policy (deterministic — never row-order-dependent):
 *   - Memberships are queried with the staff-role filter IN the SQL, so
 *     `client`/`partner_viewer` rows are invisible to selection.
 *   - TWO OR MORE active staff memberships (multi-org staff) are AMBIGUOUS:
 *     `loadByProviderUser` returns null (fail closed — multi-org membership
 *     needs an explicit org-selection mechanism in a later slice). Exactly one
 *     resolves with status "active".
 *   - With NO active staff membership, the most recent INACTIVE staff
 *     membership (by `created_at` desc) resolves with status "revoked". This
 *     makes buildSessionContext's documented precedence (membership over
 *     client link) real: a deactivated staff member who is also an active
 *     client resolves as REVOKED STAFF — the engine denies with
 *     membership_revoked — never as a working client session.
 *   - Client links: two or more ACTIVE links (multi-org client) are likewise
 *     ambiguous → null; exactly one resolves; zero yields no link.
 *
 * Fail-closed mappings:
 *   - No identity mapping, or a mapping pointing at a missing users row →
 *     null (an authenticated stranger stays unauthenticated to ΛFLO).
 *   - `identity.clerkUserId` is set from the STORED
 *     `identity_provider_accounts.provider_user_id` — never echoed from the
 *     input — so the adapter's identity cross-check in @aflo/auth
 *     provider-session.ts compares against the database, not a reflection.
 *   - `users.is_active = false` → accountStatus "disabled" (the adapter's
 *     `buildSessionContext` then resolves NO session).
 *   - `users.sessions_invalidated_before` maps to the REQUIRED
 *     `sessionsInvalidatedBeforeIso` (ADR-0035 made the field non-optional so
 *     forgetting this mapping is a type error, not a revocation bypass).
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
      .select({
        afloUserId: identityProviderAccounts.afloUserId,
        storedProviderUserId: identityProviderAccounts.providerUserId,
      })
      .from(identityProviderAccounts)
      .where(
        and(
          eq(identityProviderAccounts.provider, provider),
          eq(identityProviderAccounts.providerUserId, providerUserId),
        ),
      )
      .limit(1);
    const afloUserId = mapping[0]?.afloUserId;
    const storedProviderUserId = mapping[0]?.storedProviderUserId;
    if (!afloUserId || !storedProviderUserId) return null;

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

    const membership = await this.loadMembership(afloUserId);
    if (membership === AMBIGUOUS) return null; // 2+ active staff memberships

    const linkRows = await this.db
      .select({
        clientId: clientUserLinks.clientId,
        organizationId: clientUserLinks.organizationId,
      })
      .from(clientUserLinks)
      .where(and(eq(clientUserLinks.userId, afloUserId), eq(clientUserLinks.status, "active")))
      .limit(2);
    if (linkRows.length > 1) return null; // 2+ active client links — ambiguous
    const link = linkRows[0] ?? null;

    return {
      identity: {
        afloUserId,
        // The STORED provider id — the adapter's cross-check must compare the
        // database's mapping to the session, never the input to itself (F4).
        clerkUserId: storedProviderUserId,
        accountStatus: user.isActive ? "active" : "disabled",
        isPlatformAdmin: user.isPlatformAdmin,
        sessionsInvalidatedBeforeIso: user.sessionsInvalidatedBefore?.toISOString() ?? null,
      },
      membership: membership,
      clientLink: link ? { clientId: link.clientId, organizationId: link.organizationId } : null,
      assignedClientIds: null,
    };
  }

  /**
   * Resolve the user's staff membership per the selection policy above:
   * AMBIGUOUS for 2+ active staff memberships; one active → "active"; none
   * active → the most recent inactive staff membership as "revoked"; else null.
   */
  private async loadMembership(afloUserId: string): Promise<Membership | null | typeof AMBIGUOUS> {
    const staffRoleFilter = inArray(organizationMembers.role, [...STAFF_MEMBER_ROLES]);

    const activeRows = await this.db
      .select({
        id: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, afloUserId),
          eq(organizationMembers.isActive, true),
          staffRoleFilter,
        ),
      )
      .limit(2);
    if (activeRows.length > 1) return AMBIGUOUS;
    const active = activeRows[0];
    if (active) {
      return {
        membershipId: active.id,
        organizationId: active.organizationId,
        // Narrowed by the SQL role filter; the cast records that invariant.
        memberRole: active.role as MemberRole,
        status: "active",
      };
    }

    const inactiveRows = await this.db
      .select({
        id: organizationMembers.id,
        organizationId: organizationMembers.organizationId,
        role: organizationMembers.role,
      })
      .from(organizationMembers)
      .where(
        and(
          eq(organizationMembers.userId, afloUserId),
          eq(organizationMembers.isActive, false),
          staffRoleFilter,
        ),
      )
      .orderBy(desc(organizationMembers.createdAt))
      .limit(1);
    const inactive = inactiveRows[0];
    if (!inactive) return null;
    return {
      membershipId: inactive.id,
      organizationId: inactive.organizationId,
      memberRole: inactive.role as MemberRole,
      status: "revoked",
    };
  }
}
