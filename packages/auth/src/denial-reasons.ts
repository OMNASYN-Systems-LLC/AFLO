/**
 * Stable denial reason codes (founder directive PHASE 4: "Return stable denial
 * reason codes. Audit sensitive denials.").
 *
 * These strings are a stable contract: they surface in audit events, structured
 * logs, and (mapped to friendly copy) UI. Never renumber or repurpose a code —
 * add a new one. `allowed` is the sentinel for a granted decision.
 */

export const DENIAL_REASONS = [
  "allowed",
  "unauthenticated",
  "account_disabled",
  "no_active_membership",
  "membership_pending",
  "membership_revoked",
  "cross_tenant",
  "permission_denied",
  "not_owner",
  "not_assigned",
  "consent_required",
  "invalid_record_state",
] as const;

export type DenialReason = (typeof DENIAL_REASONS)[number];

/**
 * Denials that indicate a probe, a bug, or a boundary violation rather than a
 * benign "you can't do that here." These MUST emit an audit event (matrix §7
 * row 16). A plain `permission_denied` on a read is noisy; a cross-tenant or
 * ownership or assignment breach is a signal.
 */
const SENSITIVE: ReadonlySet<DenialReason> = new Set<DenialReason>([
  "cross_tenant",
  "not_owner",
  "not_assigned",
  "membership_revoked",
  "account_disabled",
]);

export function isSensitiveDenial(reason: DenialReason): boolean {
  return SENSITIVE.has(reason);
}
