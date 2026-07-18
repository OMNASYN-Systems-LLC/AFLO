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

/**
 * Canonical human labels for the lifecycle stages — owned by the rules
 * kernel so UI copy and deterministic report content can never drift.
 * Exhaustive by construction.
 */
export const LIFECYCLE_STAGE_LABELS: Record<LifecycleStage, string> = {
  recovery: "Recovery",
  stabilization: "Stabilization",
  credit_readiness: "Credit Readiness",
  capital_readiness: "Capital Readiness",
  acquisition: "Acquisition",
  maintenance: "Maintenance",
  growth: "Growth",
  legacy: "Legacy",
};

export type EngagementStatus = "active" | "cooling" | "at_risk" | "dormant";
