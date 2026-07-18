/**
 * Deterministic quarterly-report workflow rules (report.v1.0.0).
 *
 * Reports are generated from verified, recorded facts and always start as
 * drafts. Staff review gates publication: Draft → Ready for review →
 * Published, with explicit returns. Published is terminal — a published
 * report is a delivered artifact and is never edited in place. The
 * report-agent may later draft narrative language (aiRunId provenance);
 * it can never move a report through this workflow.
 */

export const REPORT_RULES_VERSION = "report.v1.0.0";

export const REPORT_STATUSES = ["draft", "ready_for_review", "published"] as const;

export type ReportStatusId = (typeof REPORT_STATUSES)[number];

export type ReportReasonCode =
  | "RP_SUBMITTED"
  | "RP_RETURNED"
  | "RP_PUBLISHED"
  | "RP_SAME_STATUS"
  | "RP_UNKNOWN_STATUS"
  | "RP_ILLEGAL_TRANSITION";

const ALLOWED: Record<ReportStatusId, Partial<Record<ReportStatusId, ReportReasonCode>>> = {
  draft: { ready_for_review: "RP_SUBMITTED" },
  ready_for_review: { published: "RP_PUBLISHED", draft: "RP_RETURNED" },
  published: {},
};

export interface ReportTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: ReportReasonCode;
  ruleVersion: string;
}

export function reportTransition(fromStatus: string, toStatus: string): ReportTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: REPORT_RULES_VERSION };
  const known = (s: string): s is ReportStatusId => (REPORT_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "RP_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "RP_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "RP_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

/** Calendar quarter of a date, e.g. "2026-Q3". Deterministic, UTC-based. */
export function quarterOf(date: Date): string {
  return `${date.getUTCFullYear()}-Q${Math.floor(date.getUTCMonth() / 3) + 1}`;
}

/** The three "YYYY-MM" months of a "YYYY-Qn" quarter. */
export function quarterMonths(quarter: string): string[] {
  const match = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!match) return [];
  const year = match[1]!;
  const start = (Number(match[2]) - 1) * 3;
  return [0, 1, 2].map((i) => `${year}-${String(start + i + 1).padStart(2, "0")}`);
}
