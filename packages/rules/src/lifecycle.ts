/**
 * The eight AFLO financial lifecycle stages, in order — versioned domain
 * configuration owned by the rules kernel. Stage selection is always the
 * output of versioned deterministic rules, never an LLM.
 */
export const LIFECYCLE_STAGES = [
  "recovery",
  "stabilization",
  "credit_readiness",
  "capital_readiness",
  "acquisition",
  "maintenance",
  "growth",
  "legacy",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export type EngagementStatus = "active" | "cooling" | "at_risk" | "dormant";
