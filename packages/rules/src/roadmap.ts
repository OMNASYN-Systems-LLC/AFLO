/**
 * Deterministic roadmap approval workflow (roadmap.v1.0.0).
 *
 * Founder-required path: Draft → Staff Review → Approved → Published.
 * Transitions are an allow-list — anything not listed is denied with a
 * reason code. AI may draft roadmap *language* (slice F2, roadmap-agent);
 * it can never move a roadmap through this workflow: submission, approval,
 * and publication are human staff actions (charter: a roadmap is never
 * approved without a human reviewer).
 */

export const ROADMAP_RULES_VERSION = "roadmap.v1.0.0";

export const ROADMAP_STATUSES = [
  "draft",
  "staff_review",
  "approved",
  "published",
  "archived",
] as const;

export type RoadmapStatus = (typeof ROADMAP_STATUSES)[number];

export type RoadmapReasonCode =
  | "RM_SUBMITTED"
  | "RM_APPROVED"
  | "RM_RETURNED"
  | "RM_PUBLISHED"
  | "RM_REOPENED"
  | "RM_ARCHIVED"
  | "RM_SAME_STATUS"
  | "RM_UNKNOWN_STATUS"
  | "RM_ILLEGAL_TRANSITION";

/** Allow-list: every legal move and the reason code that names it. */
const ALLOWED: Record<RoadmapStatus, Partial<Record<RoadmapStatus, RoadmapReasonCode>>> = {
  draft: { staff_review: "RM_SUBMITTED", archived: "RM_ARCHIVED" },
  staff_review: { approved: "RM_APPROVED", draft: "RM_RETURNED" },
  approved: { published: "RM_PUBLISHED", draft: "RM_REOPENED" },
  published: { archived: "RM_ARCHIVED" },
  archived: {},
};

export interface RoadmapTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: RoadmapReasonCode;
  ruleVersion: string;
}

export function roadmapTransition(fromStatus: string, toStatus: string): RoadmapTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: ROADMAP_RULES_VERSION };
  const known = (s: string): s is RoadmapStatus => (ROADMAP_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "RM_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "RM_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "RM_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}

/** Legal forward targets from a status, for UIs that offer only legal moves. */
export function roadmapTransitionsFrom(status: RoadmapStatus): RoadmapStatus[] {
  return Object.keys(ALLOWED[status]) as RoadmapStatus[];
}
