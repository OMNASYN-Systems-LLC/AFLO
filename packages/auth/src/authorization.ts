/**
 * The deterministic authorization engine (founder directive PHASE 4).
 *
 * `authorize()` is a pure function over a resolved principal, a permission, and
 * a resource reference. It has NO I/O and NO provider dependency — identity is
 * resolved elsewhere (session context) and passed in. It fails closed: every
 * gate must pass, and anything unproven is denied with a stable reason code.
 *
 * Evaluation order (first failing gate wins, most-fundamental first):
 *   1. authenticated?         → unauthenticated
 *   2. account enabled?       → account_disabled
 *   3. membership active?     → no_active_membership / membership_pending / membership_revoked
 *   4. same tenant?           → cross_tenant                 (platform admin is exempt — cross-tenant by design)
 *   5. role holds permission? → permission_denied
 *   6. owns the record?       → not_owner                    (client role only)
 *   7. assigned to it?        → not_assigned                 (staff assignment scoping, when active)
 *   8. consent on file?       → consent_required
 *   9. record state ok?       → invalid_record_state
 */

import { type DenialReason } from "./denial-reasons.js";
import { type Permission } from "./permissions.js";
import { roleHasPermission } from "./policies.js";
import { type Role } from "./roles.js";

export type MembershipStatus = "active" | "pending" | "revoked" | "none";
export type AccountStatus = "active" | "disabled";

export interface Principal {
  /** ΛFLO's own user id (never the Clerk id). Empty/absent ⇒ unauthenticated. */
  afloUserId: string;
  role: Role;
  accountStatus: AccountStatus;
  /** The tenant this principal is acting within. Null when no active membership. */
  activeOrganizationId: string | null;
  membershipStatus: MembershipStatus;
  /** Set only for the `client` role: the client record this user is linked to. */
  linkedClientId?: string | null;
  /**
   * Staff assignment scoping. When a non-null array, the staff advisor may only
   * touch client-owned resources whose clientId is in the set; when null/omitted,
   * assignment scoping is OFF and staff see every client in their org (the
   * matrix's current default — open item §8).
   */
  assignedClientIds?: readonly string[] | null;
}

export interface ResourceRef {
  /** Tenant that owns the resource. Required for every tenant-scoped check. */
  organizationId: string;
  /** Client the resource belongs to, for client-owned families. */
  clientId?: string | null;
  /** True when this action needs client consent on file (e.g. data sharing). */
  consentRequired?: boolean;
  consentGranted?: boolean;
  /** Optional record-state gate: current state vs the state the action requires. */
  recordState?: string;
  requiredRecordState?: string;
}

export interface AuthorizationRequest {
  principal: Principal;
  permission: Permission;
  resource: ResourceRef;
}

export interface AuthorizationDecision {
  allowed: boolean;
  reason: DenialReason;
}

const ALLOW: AuthorizationDecision = { allowed: true, reason: "allowed" };
function deny(reason: DenialReason): AuthorizationDecision {
  return { allowed: false, reason };
}

export function authorize(request: AuthorizationRequest): AuthorizationDecision {
  const { principal: p, permission, resource } = request;

  // 1. Authenticated identity.
  if (!p.afloUserId) return deny("unauthenticated");

  // 2. Account status (disabled accounts can do nothing, any role).
  if (p.accountStatus === "disabled") return deny("account_disabled");

  const isPlatformAdmin = p.role === "platform_admin";

  // 3. Active membership — platform admin has no membership (cross-tenant flag).
  if (!isPlatformAdmin) {
    switch (p.membershipStatus) {
      case "active":
        break;
      case "pending":
        return deny("membership_pending");
      case "revoked":
        return deny("membership_revoked");
      case "none":
        return deny("no_active_membership");
    }
    if (!p.activeOrganizationId) return deny("no_active_membership");

    // 4. Tenant isolation — the acting org must own the resource.
    if (p.activeOrganizationId !== resource.organizationId) return deny("cross_tenant");
  }

  // 5. Role must hold the permission (deny-by-default).
  if (!roleHasPermission(p.role, permission)) return deny("permission_denied");

  // 6. Ownership — a client may only act on their own linked records.
  if (p.role === "client") {
    if (!p.linkedClientId) return deny("not_owner");
    if (resource.clientId != null && resource.clientId !== p.linkedClientId) {
      return deny("not_owner");
    }
  }

  // 7. Staff assignment scoping — when active, staff are limited to assigned clients.
  if (
    p.role === "staff_advisor" &&
    p.assignedClientIds != null &&
    resource.clientId != null &&
    !p.assignedClientIds.includes(resource.clientId)
  ) {
    return deny("not_assigned");
  }

  // 8. Consent gate.
  if (resource.consentRequired && !resource.consentGranted) return deny("consent_required");

  // 9. Record-state gate (optional).
  if (
    resource.requiredRecordState !== undefined &&
    resource.recordState !== resource.requiredRecordState
  ) {
    return deny("invalid_record_state");
  }

  return ALLOW;
}

/** Convenience wrapper that throws on denial (for call sites that prefer it). */
export class AuthorizationError extends Error {
  constructor(public readonly reason: DenialReason) {
    super(`authorization denied: ${reason}`);
    this.name = "AuthorizationError";
  }
}

export function assertAuthorized(request: AuthorizationRequest): void {
  const decision = authorize(request);
  if (!decision.allowed) throw new AuthorizationError(decision.reason);
}
