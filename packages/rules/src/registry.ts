import { ENGAGEMENT_RULES_VERSION } from "./engagement";
import { READINESS_RULES_VERSION, REASON_CODE_DESCRIPTIONS } from "./readiness";

/**
 * Rule metadata registry (Product Charter, "Deterministic rules engine").
 *
 * Every deterministic rule ships with a stable identifier, version,
 * effective date, description, declared inputs/output, reason codes, and a
 * change history. Versions here are asserted against the implementation
 * constants by test/registry.test.ts so metadata cannot drift from code.
 *
 * None of these rules encode regulatory or tax thresholds; thresholds are
 * product policy for Golden Key Wealth coaching. Any future rule that does
 * depend on a regulatory value must cite its source and effective date in
 * `sources` before it may ship (charter review control).
 */

export interface RuleChangeEntry {
  version: string;
  date: string; // ISO date the version became effective
  note: string;
}

export interface RuleDefinition {
  /** Stable identifier — never reused for a different rule. */
  id: string;
  /** Current version, matching the implementation's exported constant. */
  version: string;
  effectiveDate: string; // ISO date
  description: string;
  inputs: string[];
  output: string;
  reasonCodes: string[];
  /** Regulatory/tax sources, required when thresholds are not product policy. */
  sources: string[];
  changeHistory: RuleChangeEntry[];
}

export const RULE_REGISTRY: readonly RuleDefinition[] = [
  {
    id: "readiness.stage",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Assigns the financial lifecycle stage by ordered gate evaluation over verified facts (income stability, payment history, derogatories, DTI, reserves, score, utilization). First failing gate fixes the stage; V1 tops out at acquisition.",
    inputs: [
      "creditScore",
      "utilizationPct",
      "dtiPct",
      "reserveMonths",
      "derogatoryMarks",
      "onTimePaymentRate",
      "incomeStability",
    ],
    output: "ReadinessAssessment { stage, ruleVersion, reasonCodes, factsUsed }",
    reasonCodes: Object.keys(REASON_CODE_DESCRIPTIONS),
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial gate set for the first visual slice." },
    ],
  },
  {
    id: "readiness.utilization",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Deterministic revolving-utilization calculator. Zero limit with zero balance is 0%; positive balance on a zero limit is fully utilized (100%).",
    inputs: ["revolvingBalanceCents", "revolvingLimitCents"],
    output: "utilization percentage (0..100, one decimal)",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial calculator; zero-limit semantics fixed in review." },
    ],
  },
  {
    id: "readiness.dti",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Deterministic debt-to-income calculator as a percentage; non-positive income pins to 100.",
    inputs: ["monthlyDebtPaymentsCents", "monthlyIncomeCents"],
    output: "DTI percentage (0..100+, one decimal)",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial calculator." },
    ],
  },
  {
    id: "readiness.reserves",
    version: READINESS_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Deterministic liquid-reserve coverage in months of essential expenses.",
    inputs: ["liquidSavingsCents", "monthlyEssentialExpensesCents"],
    output: "reserve months (one decimal)",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "readiness.v1.0.0", date: "2026-07-17", note: "Initial calculator." },
    ],
  },
  {
    id: "engagement.status",
    version: ENGAGEMENT_RULES_VERSION,
    effectiveDate: "2026-07-17",
    description:
      "Classifies client engagement from days since last recorded activity: <14 active, <30 cooling, <60 at_risk, otherwise dormant. Rejects unparseable timestamps.",
    inputs: ["lastActivityAt", "now"],
    output: "EngagementAssessment { status, daysSinceLastActivity, ruleVersion }",
    reasonCodes: [],
    sources: [],
    changeHistory: [
      { version: "engagement.v1.0.0", date: "2026-07-17", note: "Initial thresholds for the first visual slice." },
    ],
  },
] as const;

export function getRule(id: string): RuleDefinition | undefined {
  return RULE_REGISTRY.find((r) => r.id === id);
}
