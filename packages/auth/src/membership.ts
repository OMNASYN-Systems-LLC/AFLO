/**
 * Membership / role-change model (founder directive PHASE 4/5 tie-in).
 *
 * The ΛFLO-owned `organization_members` record and its lifecycle. This is the
 * reconciliation target that Clerk's `organizationMembership.*` webhooks
 * (ADR-0020) write into, and what an accepted invitation (ADR-0022) produces.
 * PURE and deterministic — deny-by-default illegal transitions with stable
 * reasons.
 *
 * Membership is authorization AUTHORITY (the session context reads a member's
 * role + status), so who may change/revoke a role is enforced by the calling
 * route via `authorize()` (owner-reserved `organization.manage_members`). This
 * model validates the STATE TRANSITION and records it; it never decides who is
 * allowed to invoke it, and — being a single-record model — cannot enforce
 * org-wide invariants like "an organization must keep at least one owner"
 * (a service-layer responsibility).
 */

import type { AcceptedBinding } from "./invitation";
import type { ClientLink } from "./identity";
import { memberRoleFromRole, type MemberRole } from "./roles";

export type MembershipRecordStatus = "active" | "revoked" | "pending";

/**
 * A stored `organization_members` row. Distinct from the session context's
 * `Membership` (identity.ts), which is the per-request projection of this row for
 * the CURRENT user; this record additionally carries the member's `afloUserId`
 * and audit timestamps.
 */
export interface MembershipRecord {
  membershipId: string;
  organizationId: string;
  afloUserId: string;
  memberRole: MemberRole;
  status: MembershipRecordStatus;
  createdAtIso: string;
  updatedAtIso: string;
}

export type MembershipDenial =
  | "not_active"
  | "already_revoked"
  | "already_active"
  | "same_role"
  | "not_a_membership_role"
  | "missing_client";

export type MembershipResult =
  | { ok: true; membership: MembershipRecord }
  | { ok: false; reason: MembershipDenial };

/**
 * The record an accepted invitation binding produces: a staff binding creates a
 * membership; a client binding creates a client link (clients are not members);
 * an unbindable role is rejected.
 */
export type BindingApplication =
  | { kind: "membership"; membership: MembershipRecord }
  | { kind: "client_link"; clientLink: ClientLink }
  | { kind: "rejected"; reason: MembershipDenial };

function deny(reason: MembershipDenial): { ok: false; reason: MembershipDenial } {
  return { ok: false, reason };
}

/**
 * Turn an accepted invitation binding into the ΛFLO record it implies. The
 * binding's organization/role/client are already sourced from the invitation
 * (ADR-0022), so this never trusts caller-supplied identity beyond the
 * server-issued `membershipId`/`nowIso`.
 */
export function applyAcceptedBinding(
  binding: AcceptedBinding,
  input: { membershipId: string; nowIso: string },
): BindingApplication {
  if (binding.role === "client") {
    if (!binding.clientId) return { kind: "rejected", reason: "missing_client" };
    return {
      kind: "client_link",
      clientLink: { clientId: binding.clientId, organizationId: binding.organizationId },
    };
  }

  const memberRole = memberRoleFromRole(binding.role);
  if (!memberRole) return { kind: "rejected", reason: "not_a_membership_role" };

  return {
    kind: "membership",
    membership: {
      membershipId: input.membershipId,
      organizationId: binding.organizationId,
      afloUserId: binding.afloUserId,
      memberRole,
      status: "active",
      createdAtIso: input.nowIso,
      updatedAtIso: input.nowIso,
    },
  };
}

/** Change an active membership's role (authorization of WHO may do this is the route's job). */
export function changeMemberRole(m: MembershipRecord, newRole: MemberRole, nowIso: string): MembershipResult {
  if (m.status !== "active") return deny("not_active");
  if (m.memberRole === newRole) return deny("same_role");
  return { ok: true, membership: { ...m, memberRole: newRole, updatedAtIso: nowIso } };
}

/** Revoke a membership (idempotent-guard: a revoked membership cannot be revoked again). */
export function revokeMembership(m: MembershipRecord, nowIso: string): MembershipResult {
  if (m.status === "revoked") return deny("already_revoked");
  return { ok: true, membership: { ...m, status: "revoked", updatedAtIso: nowIso } };
}

/** Reinstate a non-active membership to active. */
export function reinstateMembership(m: MembershipRecord, nowIso: string): MembershipResult {
  if (m.status === "active") return deny("already_active");
  return { ok: true, membership: { ...m, status: "active", updatedAtIso: nowIso } };
}
