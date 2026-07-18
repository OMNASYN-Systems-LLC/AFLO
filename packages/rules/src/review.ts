import { LIFECYCLE_STAGES, type LifecycleStage } from "./lifecycle";

/**
 * Deterministic staff-review gate for recorded readiness assessments
 * (review.v1.0.0).
 *
 * The charter requires high-impact outcomes to reach staff review, and the
 * readiness engine may never silently override human-approved exceptions.
 * A first assessment stands on its own; a stage that moves backward, or
 * jumps more than one stage forward in a single assessment, is flagged for
 * human review before anything downstream consumes it.
 */

export const REVIEW_RULES_VERSION = "review.v1.0.0";

export type ReviewReasonCode = "RV_STAGE_REGRESSION" | "RV_MULTI_STAGE_ADVANCE";

/** Exhaustive by construction — a new code without copy is a compile error. */
export const REVIEW_REASON_DESCRIPTIONS: Record<ReviewReasonCode, string> = {
  RV_STAGE_REGRESSION: "Stage moved backward from the previous recorded assessment",
  RV_MULTI_STAGE_ADVANCE: "Stage advanced more than one step in a single assessment",
};

export interface ReviewGateResult {
  requiresHumanReview: boolean;
  reasonCodes: ReviewReasonCode[];
  ruleVersion: string;
}

export function assessmentReviewGate(
  previousStage: LifecycleStage | null,
  nextStage: LifecycleStage,
): ReviewGateResult {
  const codes: ReviewReasonCode[] = [];
  if (previousStage !== null) {
    const prev = LIFECYCLE_STAGES.indexOf(previousStage);
    const next = LIFECYCLE_STAGES.indexOf(nextStage);
    if (next < prev) codes.push("RV_STAGE_REGRESSION");
    if (next - prev >= 2) codes.push("RV_MULTI_STAGE_ADVANCE");
  }
  return {
    requiresHumanReview: codes.length > 0,
    reasonCodes: codes,
    ruleVersion: REVIEW_RULES_VERSION,
  };
}
