import { describe, expect, it } from "vitest";
import { REASON_CODE_DESCRIPTIONS, REASON_CODE_NEXT_ACTIONS } from "../src/readiness";
import { assessmentReviewGate, REVIEW_RULES_VERSION } from "../src/review";

describe("assessmentReviewGate", () => {
  it("lets a first assessment stand on its own", () => {
    expect(assessmentReviewGate(null, "recovery")).toEqual({
      requiresHumanReview: false,
      reasonCodes: [],
      ruleVersion: REVIEW_RULES_VERSION,
    });
  });

  it("does not flag same-stage or single-step advances", () => {
    expect(assessmentReviewGate("stabilization", "stabilization").requiresHumanReview).toBe(false);
    expect(assessmentReviewGate("stabilization", "credit_readiness").requiresHumanReview).toBe(false);
  });

  it("flags stage regressions for human review", () => {
    const res = assessmentReviewGate("capital_readiness", "recovery");
    expect(res.requiresHumanReview).toBe(true);
    expect(res.reasonCodes).toEqual(["RV_STAGE_REGRESSION"]);
  });

  it("flags multi-stage advances for human review", () => {
    const res = assessmentReviewGate("recovery", "credit_readiness");
    expect(res.requiresHumanReview).toBe(true);
    expect(res.reasonCodes).toEqual(["RV_MULTI_STAGE_ADVANCE"]);
  });
});

describe("REASON_CODE_NEXT_ACTIONS", () => {
  it("proposes a next action for every readiness reason code", () => {
    expect(Object.keys(REASON_CODE_NEXT_ACTIONS).sort()).toEqual(
      Object.keys(REASON_CODE_DESCRIPTIONS).sort(),
    );
    for (const action of Object.values(REASON_CODE_NEXT_ACTIONS)) {
      expect(action.length).toBeGreaterThan(10);
    }
  });

  it("never promises score movement or approval", () => {
    for (const action of Object.values(REASON_CODE_NEXT_ACTIONS)) {
      expect(action).not.toMatch(/guarantee|will (raise|increase|improve)|approved?\b/i);
    }
  });
});
