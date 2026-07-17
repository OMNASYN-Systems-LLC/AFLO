import type { CreditProfile, FinancialProfile, LifecycleStage } from "../domain/types";

/**
 * Versioned deterministic readiness-stage engine.
 *
 * Stage selection is pure, ordered gate evaluation over verified facts.
 * No probabilistic input is permitted here; the readiness-agent may only
 * explain these outputs, never produce them (Architecture Rule 2-4).
 */

export const READINESS_RULES_VERSION = "readiness.v1.0.0";

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

/** Deterministic utilization calculator. Returns 0 for a zero limit (no revolving credit). */
export function utilizationPct(balanceCents: number, limitCents: number): number {
  if (limitCents <= 0) return 0;
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

export function toReadinessFacts(financial: FinancialProfile, credit: CreditProfile): ReadinessFacts {
  return {
    creditScore: credit.score,
    utilizationPct: utilizationPct(credit.revolvingBalanceCents, credit.revolvingLimitCents),
    dtiPct: dtiPct(financial.monthlyDebtPaymentsCents, financial.monthlyIncomeCents),
    reserveMonths: reserveMonths(financial.liquidSavingsCents, financial.monthlyEssentialExpensesCents),
    derogatoryMarks: credit.derogatoryMarks,
    onTimePaymentRate: credit.onTimePaymentRate,
    incomeStability: financial.incomeStability,
  };
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
  if (facts.onTimePaymentRate < 0.85) codes.push("RC_PAYMENT_HISTORY_POOR");
  if (facts.derogatoryMarks > 3) codes.push("RC_DEROGATORY_HIGH");
  if (codes.length > 0) {
    return { stage: "recovery", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // Gate 2 — Stabilization: cash flow not yet safe.
  if (facts.dtiPct > 45) codes.push("RC_DTI_HIGH");
  if (facts.reserveMonths < 1) codes.push("RC_RESERVES_LOW");
  if (codes.length > 0) {
    return { stage: "stabilization", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // Gate 3 — Credit Readiness: score/utilization work remains.
  if (facts.creditScore === null) codes.push("RC_SCORE_MISSING");
  else if (facts.creditScore < 640) codes.push("RC_SCORE_BELOW_CREDIT_FLOOR");
  if (facts.utilizationPct > 30) codes.push("RC_UTILIZATION_ABOVE_30");
  if (codes.length > 0) {
    return { stage: "credit_readiness", ruleVersion: READINESS_RULES_VERSION, reasonCodes: codes, factsUsed };
  }

  // Gate 4 — Capital Readiness: close, but acquisition gates not all met.
  if (facts.creditScore !== null && facts.creditScore < 680) codes.push("RC_SCORE_BELOW_CAPITAL_FLOOR");
  if (facts.utilizationPct > 10) codes.push("RC_UTILIZATION_ABOVE_10");
  if (facts.reserveMonths < 3) codes.push("RC_RESERVES_BELOW_3M");
  if (facts.dtiPct > 36) codes.push("RC_DTI_ABOVE_36");
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
