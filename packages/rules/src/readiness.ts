import type { LifecycleStage } from "./lifecycle";

/**
 * Versioned deterministic readiness-stage engine.
 *
 * Stage selection is pure, ordered gate evaluation over verified facts.
 * No probabilistic input is permitted here; the readiness-agent may only
 * explain these outputs, never produce them (Architecture Rule 2-4).
 */

export const READINESS_RULES_VERSION = "readiness.v1.0.0";

/**
 * Named gate thresholds for READINESS_RULES_VERSION. UI copy and reason-code
 * descriptions derive from these constants so displayed rationale can never
 * drift from what the gates actually enforce.
 */
export const READINESS_THRESHOLDS = {
  minOnTimePaymentRate: 0.85,
  maxDerogatoryMarks: 3,
  maxStabilizationDtiPct: 45,
  minReserveMonths: 1,
  minCreditScore: 640,
  maxCreditUtilizationPct: 30,
  minCapitalScore: 680,
  maxCapitalUtilizationPct: 10,
  minCapitalReserveMonths: 3,
  maxCapitalDtiPct: 36,
} as const;

const T = READINESS_THRESHOLDS;

export type ReasonCode =
  | "RC_INCOME_UNSTABLE"
  | "RC_PAYMENT_HISTORY_POOR"
  | "RC_DEROGATORY_HIGH"
  | "RC_DTI_HIGH"
  | "RC_RESERVES_LOW"
  | "RC_SCORE_BELOW_CREDIT_FLOOR"
  | "RC_UTILIZATION_ABOVE_30"
  | "RC_SCORE_BELOW_CAPITAL_FLOOR"
  | "RC_UTILIZATION_ABOVE_10"
  | "RC_RESERVES_BELOW_3M"
  | "RC_DTI_ABOVE_36"
  | "RC_ALL_ACQUISITION_GATES_MET"
  | "RC_SCORE_MISSING";

/**
 * Human explanations for reason codes, versioned with the rules so the
 * numbers always match the active thresholds. Exhaustive by construction:
 * adding a ReasonCode without a description is a compile error.
 */
export const REASON_CODE_DESCRIPTIONS: Record<ReasonCode, string> = {
  RC_INCOME_UNSTABLE: "Income is currently unstable",
  RC_PAYMENT_HISTORY_POOR: `On-time payment rate below ${T.minOnTimePaymentRate * 100}%`,
  RC_DEROGATORY_HIGH: `More than ${T.maxDerogatoryMarks} derogatory marks`,
  RC_DTI_HIGH: `Debt-to-income above ${T.maxStabilizationDtiPct}%`,
  RC_RESERVES_LOW: `Less than ${T.minReserveMonths} month of reserves`,
  RC_SCORE_BELOW_CREDIT_FLOOR: `Score below the ${T.minCreditScore} floor`,
  RC_UTILIZATION_ABOVE_30: `Utilization above ${T.maxCreditUtilizationPct}%`,
  RC_SCORE_BELOW_CAPITAL_FLOOR: `Score below the ${T.minCapitalScore} capital floor`,
  RC_UTILIZATION_ABOVE_10: `Utilization above ${T.maxCapitalUtilizationPct}%`,
  RC_RESERVES_BELOW_3M: `Less than ${T.minCapitalReserveMonths} months of reserves`,
  RC_DTI_ABOVE_36: `Debt-to-income above ${T.maxCapitalDtiPct}%`,
  RC_ALL_ACQUISITION_GATES_MET: "All acquisition gates met",
  RC_SCORE_MISSING: "No credit score on file",
};

export interface ReadinessFacts {
  /** FICO-range score entered manually or from an uploaded report; null if not yet captured. */
  creditScore: number | null;
  /** Revolving utilization percentage, 0..100. */
  utilizationPct: number;
  /** Debt-to-income percentage, 0..100+. */
  dtiPct: number;
  /** Liquid reserves expressed in months of essential expenses. */
  reserveMonths: number;
  derogatoryMarks: number;
  /** 0..1 on-time rate over trailing 24 months. */
  onTimePaymentRate: number;
  incomeStability: "stable" | "variable" | "unstable";
}

export interface ReadinessAssessment {
  stage: LifecycleStage;
  ruleVersion: string;
  reasonCodes: ReasonCode[];
  factsUsed: (keyof ReadinessFacts)[];
}

/**
 * Deterministic utilization calculator. A zero limit with a zero balance is
 * no revolving credit (0%); a positive balance against a zero limit (e.g.
 * debt surviving on closed accounts) is fully utilized (100%), never 0%.
 */
export function utilizationPct(balanceCents: number, limitCents: number): number {
  if (limitCents <= 0) return balanceCents > 0 ? 100 : 0;
  return round1((balanceCents / limitCents) * 100);
}

/** Deterministic debt-to-income calculator, as a percentage. */
export function dtiPct(monthlyDebtPaymentsCents: number, monthlyIncomeCents: number): number {
  if (monthlyIncomeCents <= 0) return 100;
  return round1((monthlyDebtPaymentsCents / monthlyIncomeCents) * 100);
}

/** Deterministic liquid-reserve coverage in months of essential expenses. */
export function reserveMonths(liquidSavingsCents: number, monthlyEssentialExpensesCents: number): number {
  if (monthlyEssentialExpensesCents <= 0) return 0;
  return round1(liquidSavingsCents / monthlyEssentialExpensesCents);
}

/**
 * Ordered gates, most severe first. The first failing gate fixes the stage;
 * later stages (maintenance, growth, legacy) require post-acquisition facts
 * that V1 does not capture, so V1 tops out at "acquisition".
 */
export function assessReadiness(facts: ReadinessFacts): ReadinessAssessment {
  const codes: ReasonCode[] = [];
  const factsUsed: (keyof ReadinessFacts)[] = [
    "creditScore",
    "utilizationPct",
    "dtiPct",
    "reserveMonths",
    "derogatoryMarks",
    "onTimePaymentRate",
    "incomeStability",
  ];

  // Gate 1 — Recovery: active damage or no dependable income.
  if (facts.incomeStability === "unstable") codes.push("RC_INCOME_UNSTABLE");
  if (facts.onTimePaymentRate < T.minOnTimePaymentRate) codes.push("RC_PAYMENT_HISTORY_POOR");
  if (facts.derogatoryMarks > T.maxDerogatoryMarks) codes.push("RC_DEROGATORY_HIGH");
  if (codes.length > 0) {
    return { stage: "recovery", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // Gate 2 — Stabilization: cash flow not yet safe.
  if (facts.dtiPct > T.maxStabilizationDtiPct) codes.push("RC_DTI_HIGH");
  if (facts.reserveMonths < T.minReserveMonths) codes.push("RC_RESERVES_LOW");
  if (codes.length > 0) {
    return { stage: "stabilization", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // Gate 3 — Credit Readiness: score/utilization work remains.
  if (facts.creditScore === null) codes.push("RC_SCORE_MISSING");
  else if (facts.creditScore < T.minCreditScore) codes.push("RC_SCORE_BELOW_CREDIT_FLOOR");
  if (facts.utilizationPct > T.maxCreditUtilizationPct) codes.push("RC_UTILIZATION_ABOVE_30");
  if (codes.length > 0) {
    return { stage: "credit_readiness", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // Gate 4 — Capital Readiness: close, but acquisition gates not all met.
  if (facts.creditScore !== null && facts.creditScore < T.minCapitalScore) codes.push("RC_SCORE_BELOW_CAPITAL_FLOOR");
  if (facts.utilizationPct > T.maxCapitalUtilizationPct) codes.push("RC_UTILIZATION_ABOVE_10");
  if (facts.reserveMonths < T.minCapitalReserveMonths) codes.push("RC_RESERVES_BELOW_3M");
  if (facts.dtiPct > T.maxCapitalDtiPct) codes.push("RC_DTI_ABOVE_36");
  if (codes.length > 0) {
    return { stage: "capital_readiness", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // All acquisition gates met.
  return {
    stage: "acquisition",
    ruleVersion: READINESS_RULES_VERSION,
    reasonCodes: ["RC_ALL_ACQUISITION_GATES_MET"],
    factsUsed,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
