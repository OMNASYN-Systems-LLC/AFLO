/**
 * Deterministic profile-relevance matching (opportunity.v1.0.0).
 *
 * This decides SURFACE-WORTHINESS only — "is this notice worth showing" — from
 * jurisdiction, freshness, and goal alignment. It is emphatically NOT an
 * eligibility determination: a `relevant` result means "a staff member (or,
 * after review, the client) may want to review the official terms", nothing
 * more. Legal/claims categories additionally require staff review before any
 * client sees them.
 */

import {
  REVIEW_REQUIRED_CATEGORIES,
  type OpportunityCategory,
  type OpportunityNotice,
} from "./model";

/** Categories that only surface when the client has an aligned goal. */
const CATEGORY_GOAL_ALIGNMENT: Partial<Record<OpportunityCategory, readonly string[]>> = {
  housing_program: ["home_purchase", "savings"],
  assistance_program: ["home_purchase", "savings", "debt"],
};

export const OPPORTUNITY_MATCH_REASON_CODES = [
  "OM_FEDERAL",
  "OM_JURISDICTION_MATCH",
  "OM_GOAL_ALIGNED",
  "OM_BROADLY_APPLICABLE",
  "OM_EXPIRED",
  "OM_JURISDICTION_MISMATCH",
  "OM_NOT_GOAL_ALIGNED",
] as const;

export type OpportunityMatchReasonCode = (typeof OPPORTUNITY_MATCH_REASON_CODES)[number];

/** Non-identifying signals used to decide surface-worthiness. */
export interface ClientOpportunitySignals {
  /** The client's jurisdiction, e.g. "US-CA". */
  jurisdiction: string;
  /** The client's goal categories (from Goal.category). */
  goalCategories: readonly string[];
  now: Date;
}

export interface OpportunityMatch {
  /** Worth surfacing (to staff, or to the client after any required review). */
  relevant: boolean;
  reasonCodes: OpportunityMatchReasonCode[];
  /** Must a staff member review before this reaches a client? */
  requiresReview: boolean;
}

/**
 * Deterministic surface-worthiness. Fails closed: an expired notice, a
 * jurisdiction mismatch, or a goal-gated category without an aligned goal is
 * NOT surfaced. Federal notices apply to every jurisdiction.
 */
export function matchNoticeToProfile(
  notice: OpportunityNotice,
  signals: ClientOpportunitySignals,
): OpportunityMatch {
  const requiresReview = REVIEW_REQUIRED_CATEGORIES.includes(notice.category);
  const reasonCodes: OpportunityMatchReasonCode[] = [];

  if (notice.expirationDate !== null) {
    const exp = Date.parse(notice.expirationDate);
    // Fail closed: an unparseable expiration is treated as expired. A date-only
    // value parses to UTC midnight; the notice stays valid THROUGH that day, so
    // compare against the end of the expiration day (+24h).
    const MS_PER_DAY = 24 * 60 * 60 * 1000;
    if (Number.isNaN(exp) || exp + MS_PER_DAY <= signals.now.getTime()) {
      return { relevant: false, reasonCodes: ["OM_EXPIRED"], requiresReview };
    }
  }

  if (notice.jurisdiction === "US") {
    reasonCodes.push("OM_FEDERAL");
  } else if (notice.jurisdiction === signals.jurisdiction) {
    reasonCodes.push("OM_JURISDICTION_MATCH");
  } else {
    return { relevant: false, reasonCodes: ["OM_JURISDICTION_MISMATCH"], requiresReview };
  }

  const requiredGoals = CATEGORY_GOAL_ALIGNMENT[notice.category];
  if (requiredGoals) {
    if (requiredGoals.some((g) => signals.goalCategories.includes(g))) {
      reasonCodes.push("OM_GOAL_ALIGNED");
    } else {
      return { relevant: false, reasonCodes: [...reasonCodes, "OM_NOT_GOAL_ALIGNED"], requiresReview };
    }
  } else {
    reasonCodes.push("OM_BROADLY_APPLICABLE");
  }

  return { relevant: true, reasonCodes, requiresReview };
}
