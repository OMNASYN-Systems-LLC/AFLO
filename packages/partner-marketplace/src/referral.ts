/**
 * Deterministic partner-referral lifecycle rules (partner.v1.0.0).
 *
 * A referral is TRACKED through a fixed lifecycle. AFLO records that it routed
 * a client to a licensed partner and, later, a staff-observed outcome — it
 * never approves a loan, guarantees acceptance, or claims a partner decision.
 * The referral-routing agent may draft a suggestion; it can never move a
 * referral through this workflow.
 *
 *   suggested → shared_with_client → client_engaged → outcome_recorded
 *   (and → declined from any non-terminal state)
 *
 * `outcome_recorded` and `declined` are terminal.
 */

import { PARTNER_RULES_VERSION } from "./catalog";

export const PARTNER_REFERRAL_STATUSES = [
  "suggested",
  "shared_with_client",
  "client_engaged",
  "outcome_recorded",
  "declined",
] as const;

export type PartnerReferralStatus = (typeof PARTNER_REFERRAL_STATUSES)[number];

export const PARTNER_REFERRAL_STATUS_LABELS: Record<PartnerReferralStatus, string> = {
  suggested: "Suggested",
  shared_with_client: "Shared with client",
  client_engaged: "Client engaged",
  outcome_recorded: "Outcome recorded",
  declined: "Declined",
};

export type PartnerReferralReasonCode =
  | "PR_SHARED"
  | "PR_ENGAGED"
  | "PR_OUTCOME"
  | "PR_DECLINED"
  | "PR_SAME_STATUS"
  | "PR_UNKNOWN_STATUS"
  | "PR_ILLEGAL_TRANSITION";

const ALLOWED: Record<PartnerReferralStatus, Partial<Record<PartnerReferralStatus, PartnerReferralReasonCode>>> = {
  suggested: { shared_with_client: "PR_SHARED", declined: "PR_DECLINED" },
  shared_with_client: { client_engaged: "PR_ENGAGED", declined: "PR_DECLINED" },
  client_engaged: { outcome_recorded: "PR_OUTCOME", declined: "PR_DECLINED" },
  outcome_recorded: {},
  declined: {},
};

export interface PartnerReferralTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: PartnerReferralReasonCode;
  ruleVersion: string;
}

export function partnerReferralTransition(fromStatus: string, toStatus: string): PartnerReferralTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: PARTNER_RULES_VERSION };
  const known = (s: string): s is PartnerReferralStatus =>
    (PARTNER_REFERRAL_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "PR_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "PR_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "PR_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

export function isTerminalReferralStatus(status: PartnerReferralStatus): boolean {
  return Object.keys(ALLOWED[status]).length === 0;
}

/**
 * The staff-observed result of an engaged referral. These are observations,
 * never approvals — AFLO does not decide or guarantee a partner's outcome.
 */
export const REFERRAL_OUTCOMES = ["engaged_supported_readiness", "engaged_no_change", "not_pursued"] as const;

export type ReferralOutcome = (typeof REFERRAL_OUTCOMES)[number];

export const REFERRAL_OUTCOME_LABELS: Record<ReferralOutcome, string> = {
  engaged_supported_readiness: "Engaged — supported readiness",
  engaged_no_change: "Engaged — no readiness change",
  not_pursued: "Not pursued",
};
