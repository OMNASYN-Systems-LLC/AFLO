/**
 * Authorization roles (founder directive: Auth/Authz/Production-Runtime phase).
 *
 * This is the six-role authorization vocabulary the policy engine reasons over.
 * It is DISTINCT from the domain membership role (`MemberRole` in
 * `@aflo/shared`, which is only `organization_owner | organization_admin |
 * staff`): a principal's authorization role is resolved per request from
 * several signals — an `organization_members` row, the platform-admin flag on
 * `users`, or a client-account link — not from a single column. Keeping the two
 * separate avoids reshaping the membership table to carry non-membership roles
 * (platform admin is a flag, client is a linked account, partner viewer is a
 * deferred grant model). See docs/architecture/AUTHORIZATION_MATRIX.md §1.
 */

export const ROLES = [
  "platform_admin",
  "organization_owner",
  "organization_admin",
  "staff_advisor",
  "client",
  "partner_viewer",
] as const;

export type Role = (typeof ROLES)[number];

/** The domain membership roles that live in `organization_members`. */
export type MemberRole = "organization_owner" | "organization_admin" | "staff";

/**
 * Bridge a membership-table role to its authorization role. Only the three
 * org-staff roles map directly; `platform_admin` (a `users` flag), `client`
 * (a client-account link), and `partner_viewer` (a future data-sharing grant)
 * are resolved from other signals, never from a membership row.
 */
export function roleFromMemberRole(memberRole: MemberRole): Role {
  switch (memberRole) {
    case "organization_owner":
      return "organization_owner";
    case "organization_admin":
      return "organization_admin";
    case "staff":
      return "staff_advisor";
    default: {
      // Fail loud on an out-of-enum value (e.g. a bad DB row cast to MemberRole)
      // rather than silently minting an undefined role.
      const unexpected: never = memberRole;
      throw new Error(`unknown member role: ${String(unexpected)}`);
    }
  }
}

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}

/**
 * The inverse of `roleFromMemberRole`: the membership-table role for an
 * authorization role, or `null` for roles that are NOT `organization_members`
 * rows (`client` is an account link; `platform_admin` a flag; `partner_viewer`
 * a deferred grant).
 */
export function memberRoleFromRole(role: Role): MemberRole | null {
  switch (role) {
    case "organization_owner":
      return "organization_owner";
    case "organization_admin":
      return "organization_admin";
    case "staff_advisor":
      return "staff";
    case "client":
    case "platform_admin":
    case "partner_viewer":
      return null;
    default: {
      // Fail loud if a new Role is added without a case here (noImplicitReturns
      // is off, so the switch would otherwise silently return undefined).
      const unexpected: never = role;
      throw new Error(`unknown role: ${String(unexpected)}`);
    }
  }
}
