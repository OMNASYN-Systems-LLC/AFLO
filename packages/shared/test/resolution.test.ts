import { describe, expect, it } from "vitest";
import { assessEngagement, RESOLUTION_RULES_VERSION } from "@aflo/rules";
import {
  buildResolutionReadout,
  toReadinessInputPresence,
  type ResolutionReadoutInput,
} from "../src";
import type {
  ClientDocument,
  CreditProfile,
  FinancialProfile,
  Goal,
  ReadinessAssessmentRecord,
} from "../src";

const NOW = new Date("2026-07-19T12:00:00.000Z");

const financial: FinancialProfile = {
  clientId: "c1",
  monthlyIncomeCents: 600000,
  monthlyDebtPaymentsCents: 150000,
  liquidSavingsCents: 900000,
  monthlyEssentialExpensesCents: 300000,
  incomeStability: "stable",
};

const credit: CreditProfile = {
  clientId: "c1",
  score: 660,
  scoreSource: "manual_entry",
  scoreAsOf: "2026-07-01",
  revolvingBalanceCents: 200000,
  revolvingLimitCents: 800000,
  openTradelines: 4,
  derogatoryMarks: 0,
  onTimePaymentRate: 0.98,
};

const assessment: ReadinessAssessmentRecord = {
  id: "a1",
  clientId: "c1",
  stage: "credit_readiness",
  previousStage: "stabilization",
  ruleVersion: "readiness.v1.0.0",
  reasonCodes: ["RC_UTILIZATION_ABOVE_30", "RC_SCORE_BELOW_CREDIT_FLOOR"],
  factsUsed: ["utilizationPct", "creditScore"],
  proposedNextAction: "Reduce revolving utilization below 30%.",
  requiresHumanReview: false,
  reviewReasonCodes: [],
  assessedAt: "2026-07-18T09:00:00.000Z",
  actorStaffId: "s1",
};

const primaryGoal: Goal = {
  id: "g1",
  clientId: "c1",
  title: "Mortgage-ready in 12 months",
  category: "home_purchase",
  targetDate: "2027-07-01",
  progressPct: 40,
  isPrimary: true,
};

const documents: ClientDocument[] = [
  { id: "d1", clientId: "c1", name: "Paystub", docType: "income_verification", reviewStatus: "approved", updatedAt: "2026-07-10" },
  { id: "d2", clientId: "c1", name: "Bank stmt", docType: "bank_statement", reviewStatus: "needs_attention", updatedAt: "2026-07-11" },
  { id: "d3", clientId: "c1", name: "ID", docType: "identification", reviewStatus: "in_review", updatedAt: "2026-07-12" },
];

function baseInput(overrides: Partial<ResolutionReadoutInput> = {}): ResolutionReadoutInput {
  return {
    clientId: "c1",
    financial,
    credit,
    latestAssessment: assessment,
    intakeComplete: true,
    engagement: assessEngagement("2026-07-15T00:00:00.000Z", NOW),
    primaryGoal,
    documents,
    now: NOW,
    ...overrides,
  };
}

describe("toReadinessInputPresence", () => {
  it("marks every fact present when both profiles exist and the score is set", () => {
    const p = toReadinessInputPresence(financial, credit);
    expect(Object.values(p).every(Boolean)).toBe(true);
  });

  it("credit score is absent when the profile carries a null score", () => {
    const p = toReadinessInputPresence(financial, { ...credit, score: null });
    expect(p.creditScore).toBe(false);
    expect(p.utilizationPct).toBe(true); // other credit facts still present
  });

  it("all credit facts absent without a credit profile; all financial facts absent without a financial profile", () => {
    expect(toReadinessInputPresence(financial, null)).toMatchObject({
      creditScore: false,
      utilizationPct: false,
      derogatoryMarks: false,
      onTimePaymentRate: false,
      dtiPct: true,
      reserveMonths: true,
      incomeStability: true,
    });
    expect(toReadinessInputPresence(null, credit).dtiPct).toBe(false);
  });
});

describe("buildResolutionReadout composes verified facts (understand → diagnose → organize)", () => {
  it("full picture: understanding complete, diagnosis from the recorded assessment, obligations computed", () => {
    const r = buildResolutionReadout(baseInput());
    expect(r.understanding.canDiagnose).toBe(true);
    expect(r.understanding.completionPct).toBe(100);
    expect(r.diagnosis?.stage).toBe("credit_readiness");
    expect(r.diagnosis?.bindingBlocker).toBe("RC_UTILIZATION_ABOVE_30"); // first reason code
    expect(r.obligations?.utilizationPct).toBe(25); // 200000/800000
    expect(r.obligations?.dtiPct).toBe(25); // 150000/600000
    expect(r.generatedAt).toBe(NOW.toISOString());
  });

  it("does NOT recompute the diagnosis — it mirrors the recorded assessment verbatim", () => {
    const r = buildResolutionReadout(baseInput());
    expect(r.diagnosis?.reasonCodes).toEqual(assessment.reasonCodes);
    expect(r.diagnosis?.proposedNextAction).toBe(assessment.proposedNextAction);
    expect(r.diagnosis?.assessedAt).toBe(assessment.assessedAt);
  });

  it("diagnosis is null before the first recorded assessment; understanding still reports", () => {
    const r = buildResolutionReadout(baseInput({ latestAssessment: null }));
    expect(r.diagnosis).toBeNull();
    expect(r.understanding.canDiagnose).toBe(true);
  });

  it("obligations null and understanding blocked when a profile is missing", () => {
    const r = buildResolutionReadout(baseInput({ credit: null }));
    expect(r.obligations).toBeNull();
    expect(r.understanding.canDiagnose).toBe(false);
    expect(r.understanding.blockingMissingKeys).toContain("utilizationPct");
  });

  it("document readiness counts by terminal vs pending review state", () => {
    const r = buildResolutionReadout(baseInput());
    expect(r.documentReadiness).toEqual({ total: 3, approved: 1, needsAttention: 1, pending: 1 });
  });

  it("records deterministic provenance (resolution + engagement + readiness rule versions)", () => {
    const r = buildResolutionReadout(baseInput());
    expect(r.ruleVersions).toContain(RESOLUTION_RULES_VERSION);
    expect(r.ruleVersions).toContain("engagement.v1.0.0");
    expect(r.ruleVersions).toContain("readiness.v1.0.0");
    // deduped
    expect(new Set(r.ruleVersions).size).toBe(r.ruleVersions.length);
  });

  it("surfaces the primary goal compactly", () => {
    const r = buildResolutionReadout(baseInput());
    expect(r.primaryGoal).toEqual({
      title: "Mortgage-ready in 12 months",
      category: "home_purchase",
      targetDate: "2027-07-01",
      progressPct: 40,
    });
  });
});
