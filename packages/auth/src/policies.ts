/**
 * Role → permission policy map (founder directive PHASE 4), derived from
 * docs/architecture/AUTHORIZATION_MATRIX.md §4. Deny-by-default: any permission
 * not granted to a role here is denied.
 *
 * Ownership, tenant, assignment, and consent are NOT encoded here — this map is
 * "which permissions can this role EVER hold." The contextual gates (own record,
 * same tenant, assigned staff, consent on file) are applied by authorize().
 */

import { PERMISSIONS, type Permission } from "./permissions";
import type { Role } from "./roles";

/** Organization Owner: full administration of the tenant — every permission. */
const OWNER: readonly Permission[] = [...PERMISSIONS];

/**
 * Organization Admin: Owner minus the single owner-reserved capability present
 * in this token set — managing memberships. (Partner-directory management, the
 * other owner-reserved capability in the matrix, has no permission token yet.)
 */
const ADMIN: readonly Permission[] = PERMISSIONS.filter(
  (p) => p !== "organization.manage_members",
);

/** Golden Key Staff / Advisor: operate the CRM, workflow, docs, messaging, reports. */
const STAFF_ADVISOR: readonly Permission[] = [
  "lead.read",
  "lead.create",
  "lead.update",
  "lead.convert",
  "client.read",
  "client.update",
  "intake.read",
  "intake.review",
  "intake.approve",
  "roadmap.create",
  "roadmap.review",
  "roadmap.approve",
  "roadmap.publish",
  "task.assign",
  "task.verify",
  "document.request",
  "document.read",
  "document.review",
  "document.download",
  "appointment.manage",
  "appointment.book",
  "message.send",
  "message.read",
  "message.assign",
  "message.close",
  "report.generate",
  "report.review",
  "report.publish",
];

/** Client: self-service over OWN records only (ownership enforced by authorize()). */
const CLIENT: readonly Permission[] = [
  "client.read",
  "intake.read",
  "document.read",
  "document.download",
  "appointment.book",
  "message.send",
  "message.read",
];

/**
 * Platform Admin: cross-tenant but read-only over tenant data + audit, and never
 * a participant in tenant approval/mutation workflows (matrix footnote a).
 * Platform-management powers (org provisioning, rule-version publishing) live in
 * a separate platform surface, not in this tenant-permission vocabulary.
 */
const PLATFORM_ADMIN: readonly Permission[] = [
  "lead.read",
  "client.read",
  "intake.read",
  "document.read",
  "document.download",
  "message.read",
  "billing.read",
  "audit.read",
];

/** Partner Viewer: deferred past V1 — no permissions (reserved, deny-by-default). */
const PARTNER_VIEWER: readonly Permission[] = [];

const ROLE_PERMISSIONS: Readonly<Record<Role, ReadonlySet<Permission>>> = {
  platform_admin: new Set(PLATFORM_ADMIN),
  organization_owner: new Set(OWNER),
  organization_admin: new Set(ADMIN),
  staff_advisor: new Set(STAFF_ADVISOR),
  client: new Set(CLIENT),
  partner_viewer: new Set(PARTNER_VIEWER),
};

/**
 * The permissions a role can ever hold, before contextual gates. Returns a fresh
 * copy so a caller cannot mutate the internal policy map by reference (a
 * `ReadonlySet` is only a compile-time promise; the underlying `Set` is mutable).
 */
export function permissionsForRole(role: Role): ReadonlySet<Permission> {
  const set = ROLE_PERMISSIONS[role];
  return new Set(set ?? []);
}

/** Pure role→permission check (no context). Fails closed on an unknown role. */
export function roleHasPermission(role: Role, permission: Permission): boolean {
  const set = ROLE_PERMISSIONS[role];
  return set ? set.has(permission) : false;
}
