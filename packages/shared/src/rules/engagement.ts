import { MS_PER_DAY } from "../domain/time";
import type { EngagementStatus } from "../domain/types";

/**
 * Versioned deterministic engagement/retention rules.
 * Thresholds are days since last recorded client activity.
 */

export const ENGAGEMENT_RULES_VERSION = "engagement.v1.0.0";

/** Canonical staff-facing labels for engagement statuses. */
export const ENGAGEMENT_STATUS_LABELS: Record<EngagementStatus, string> = {
  active: "Engaged",
  cooling: "Cooling",
  at_risk: "At risk",
  dormant: "Dormant",
};

export interface EngagementAssessment {
  status: EngagementStatus;
  daysSinceLastActivity: number;
  ruleVersion: string;
}

export function assessEngagement(lastActivityAt: string, now: Date): EngagementAssessment {
  const last = new Date(lastActivityAt).getTime();
  if (Number.isNaN(last)) {
    // Deterministic rules reject invalid facts loudly rather than guessing.
    throw new TypeError(`assessEngagement: invalid lastActivityAt "${lastActivityAt}"`);
  }
  const days = Math.max(0, Math.floor((now.getTime() - last) / MS_PER_DAY));

  let status: EngagementStatus;
  if (days < 14) status = "active";
  else if (days < 30) status = "cooling";
  else if (days < 60) status = "at_risk";
  else status = "dormant";

  return { status, daysSinceLastActivity: days, ruleVersion: ENGAGEMENT_RULES_VERSION };
}
