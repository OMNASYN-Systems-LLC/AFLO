/**
 * Deterministic document review-state rules (document.v1.0.0).
 *
 * Documents move requested → uploaded → in_review → approved or
 * needs_attention; a flagged document re-enters through re-upload. Approved
 * is terminal — an approved document is a verified fact; replacing it means
 * requesting a new document, never silently downgrading the old one.
 * Metadata workflow only: file contents live in external storage behind
 * signed URLs (deferred requirement), never in AFLO records.
 */

export const DOCUMENT_RULES_VERSION = "document.v1.0.0";

export const DOCUMENT_REVIEW_STATUSES = [
  "requested",
  "uploaded",
  "in_review",
  "approved",
  "needs_attention",
] as const;

export type DocumentReviewStatusId = (typeof DOCUMENT_REVIEW_STATUSES)[number];

export type DocumentReasonCode =
  | "DOC_UPLOADED"
  | "DOC_REVIEW_STARTED"
  | "DOC_APPROVED"
  | "DOC_FLAGGED"
  | "DOC_RESUBMITTED"
  | "DOC_SAME_STATUS"
  | "DOC_UNKNOWN_STATUS"
  | "DOC_ILLEGAL_TRANSITION";

const ALLOWED: Record<DocumentReviewStatusId, Partial<Record<DocumentReviewStatusId, DocumentReasonCode>>> = {
  requested: { uploaded: "DOC_UPLOADED" },
  uploaded: { in_review: "DOC_REVIEW_STARTED" },
  in_review: { approved: "DOC_APPROVED", needs_attention: "DOC_FLAGGED" },
  needs_attention: { uploaded: "DOC_RESUBMITTED" },
  approved: {},
};

export interface DocumentTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: DocumentReasonCode;
  ruleVersion: string;
}

export function documentTransition(fromStatus: string, toStatus: string): DocumentTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: DOCUMENT_RULES_VERSION };
  const known = (s: string): s is DocumentReviewStatusId =>
    (DOCUMENT_REVIEW_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "DOC_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "DOC_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "DOC_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

/** Legal next statuses, for UIs that offer only legal moves. */
export function documentTransitionsFrom(status: DocumentReviewStatusId): DocumentReviewStatusId[] {
  return Object.keys(ALLOWED[status]) as DocumentReviewStatusId[];
}
