import type {
  ReviewArtifactType,
  ReviewDecision,
  ReviewItemState,
  ReviewRiskClass,
  ReviewerRole,
} from "@aflo/shared";

/**
 * Human Review Center labels + server-action result shape.
 *
 * Pure data only (type-only imports) so client components can import this
 * without pulling the store or any server-only runtime into the browser
 * bundle. The store is the single authority for every review decision — these
 * maps only TRANSLATE its denial codes into staff-readable sentences; the UI
 * never re-implements or pre-empts the authorization itself (ADR-0045).
 */

export const REVIEW_ARTIFACT_TYPE_LABELS: Record<ReviewArtifactType, string> = {
  readiness_assessment: "Readiness assessment",
  roadmap_draft: "Roadmap draft",
  concierge_recommendation: "Concierge recommendation",
  document_interpretation: "Document interpretation",
  financial_summary: "Financial summary",
  educational_assignment: "Educational assignment",
  partner_referral: "Partner referral",
  client_communication: "Client communication",
  quarterly_report: "Quarterly report",
  stage_advancement: "Stage advancement",
};

export const REVIEW_STATE_LABELS: Record<ReviewItemState, string> = {
  draft: "Draft",
  awaiting_review: "Awaiting review",
  approved: "Approved",
  published: "Published",
  rejected: "Rejected",
  deferred: "Deferred",
  withdrawn: "Withdrawn",
  superseded: "Superseded",
};

export const REVIEW_DECISION_LABELS: Record<ReviewDecision, string> = {
  approved_unchanged: "Approve unchanged",
  approved_with_edits: "Approve with edits",
  rejected: "Reject",
  escalated: "Escalate",
  deferred: "Defer",
};

/** Past-tense labels for the append-only decision history. */
export const REVIEW_DECISION_PAST_LABELS: Record<ReviewDecision, string> = {
  approved_unchanged: "Approved unchanged",
  approved_with_edits: "Approved with edits",
  rejected: "Rejected",
  escalated: "Escalated",
  deferred: "Deferred",
};

export const REVIEW_RISK_LABELS: Record<ReviewRiskClass, string> = {
  low: "Low risk",
  medium: "Medium risk",
  high: "High risk",
};

export const REVIEWER_ROLE_LABELS: Record<ReviewerRole, string> = {
  staff: "Advisor/Staff",
  organization_admin: "Organization Admin",
  organization_owner: "Organization Owner",
};

/**
 * Staff-readable sentences for the store's RVC_* denial reason codes. The
 * store decided; the UI only explains. Unknown codes fall through to a
 * generic sentence that still shows the raw code — a denial is never hidden.
 */
export const REVIEW_DENIAL_MESSAGES: Record<string, string> = {
  RVC_INSUFFICIENT_ROLE: "Your role is below the required reviewer role for this action.",
  RVC_SELF_REVIEW_DENIED:
    "Separation of duties — a high-risk item cannot be reviewed by its author.",
  RVC_NOT_ASSIGNED_REVIEWER:
    "This item is assigned to another reviewer; only the assignee or an Organization Admin+ may decide it.",
  RVC_REVIEWER_NOT_MEMBER: "The actor is not a member of this organization.",
  RVC_ROLE_NOT_REVIEWER: "This role is not a reviewer role.",
  RVC_NOT_AWAITING_REVIEW: "Decisions are only legal while the item is awaiting review.",
  RVC_UNKNOWN_DECISION: "Unknown decision.",
  RVC_INVALID_REASON_CODE: "The selected reason code is not valid for this decision.",
  RVC_MISSING_MODIFICATIONS: "Approve with edits requires at least one edited field name.",
  RVC_UNEXPECTED_MODIFICATIONS: "Approve unchanged cannot carry edited fields.",
  RVC_INVALID_MODIFICATION_COUNT: "Edited-field count is malformed.",
  RVC_ESCALATION_CEILING:
    "Already at the Organization Owner floor — there is no higher rank to escalate to.",
  RVC_ILLEGAL_TRANSITION: "That state change is not legal for this item.",
  RVC_SAME_STATE: "The item is already in that state.",
  RVC_UNKNOWN_STATE: "Unknown review state.",
  RVC_STALE_ARTIFACT: "Artifact changed since approval — new review required.",
  RVC_BLOCKED_ENVELOPE: "Blocked envelope — prohibited actions were detected.",
  RVC_BRIDGED_ARTIFACT:
    "This item shadows its domain workflow — move the roadmap/report itself; its review state follows automatically.",
};

/** Fallbacks for store denial codes that carry no kernel reason code. */
export const REVIEW_DENIAL_CODE_MESSAGES: Record<string, string> = {
  REVIEW_ITEM_NOT_FOUND: "Review item not found in this organization.",
  ACTOR_NOT_IN_ORG: "The actor is not a member of this organization.",
  NOT_AUTHORIZED: "Not authorized.",
  INVALID_INPUT: "The input was rejected.",
  OPEN_REVIEW_EXISTS: "An open review already exists for this artifact version.",
  BLOCKED_ENVELOPE: "Blocked envelope — prohibited actions were detected.",
  STALE_ARTIFACT: "Artifact changed since approval — new review required.",
  BRIDGED_ARTIFACT:
    "This item shadows its domain workflow — move the roadmap/report itself; its review state follows automatically.",
  CLIENT_NOT_FOUND: "Client not found in this organization.",
  PLAYBOOK_NOT_FOUND: "Playbook not found in this organization.",
};

/**
 * Serializable result a review server action returns for inline rendering.
 * Denials come verbatim from the store result — the UI renders them, it never
 * decides them.
 */
export type ReviewActionState =
  | { status: "idle" }
  | { status: "success"; message: string }
  | {
      status: "denied";
      message: string;
      /** RVC_* reason code or store denial code, for the visible audit trail. */
      code: string | null;
      /** The stale-artifact denial gets its own distinct rendering. */
      stale: boolean;
      inputErrors: string[];
    };

/** Median-minutes display: honest "—" for null, humanized above an hour. */
export function fmtReviewMinutes(minutes: number | null): string {
  if (minutes === null) return "—";
  if (minutes < 60) return `${Math.round(minutes)} min`;
  const hours = minutes / 60;
  return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} h`;
}

/** Fraction 0..1 → whole percent; null (empty denominator) → "—", never 0%. */
export function fmtRateOrDash(rate: number | null): string {
  return rate === null ? "—" : `${Math.round(rate * 100)}%`;
}

/** Truncated digest for display — full value belongs in the title attribute. */
export function shortDigest(digest: string, length = 16): string {
  return digest.length > length ? `${digest.slice(0, length)}…` : digest;
}
