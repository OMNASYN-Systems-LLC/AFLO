/**
 * Deterministic lead→client pipeline rules (pipeline.v1.0.0).
 *
 * The pipeline is versioned domain configuration: organizations may define
 * their own stages (charter: configurable pipeline stages), but transitions
 * are always evaluated by these rules — required stages can never be
 * silently skipped, and every decision carries a reason code. Terminal
 * activation hands the record off to the client lifecycle (client_status);
 * post-activation states are out of pipeline scope.
 */

export const PIPELINE_RULES_VERSION = "pipeline.v1.0.0";

export interface PipelineStageDefinition {
  /** Stable id referenced by records and events (e.g. "consultation_scheduled"). */
  id: string;
  label: string;
  /** Position in the pipeline; unique, ascending. */
  order: number;
  /** Required stages cannot be skipped on the forward path. */
  required: boolean;
  /** Exactly one terminal stage, last in order, always required. */
  terminal: boolean;
}

export interface PipelineDefinition {
  id: string;
  version: string;
  stages: PipelineStageDefinition[];
}

/**
 * Founder-required backbone stage ids. Organizations may insert optional
 * stages around them, but these ids are the stable workflow contract other
 * workflows key off (e.g. the intake workflow starts at `intakeStarted` and
 * gates entry to `intakeCompleted` on intake completeness). Renaming one is
 * a breaking workflow change, never a config tweak.
 */
export const PIPELINE_BACKBONE = {
  newLead: "new_lead",
  consultationScheduled: "consultation_scheduled",
  intakeStarted: "intake_started",
  intakeCompleted: "intake_completed",
  clientActivated: "client_activated",
} as const;

/**
 * Golden Key default pipeline (founder-required path). Organizations may
 * insert optional stages between the required ones via settings; the
 * required backbone below is the workflow contract:
 * Lead → Consultation Scheduled → Intake Started → Intake Completed → Client Activated.
 */
export const DEFAULT_PIPELINE: PipelineDefinition = {
  id: "golden-key-default",
  version: PIPELINE_RULES_VERSION,
  stages: [
    { id: PIPELINE_BACKBONE.newLead, label: "New lead", order: 1, required: true, terminal: false },
    { id: PIPELINE_BACKBONE.consultationScheduled, label: "Consultation scheduled", order: 2, required: true, terminal: false },
    { id: PIPELINE_BACKBONE.intakeStarted, label: "Intake started", order: 3, required: true, terminal: false },
    { id: PIPELINE_BACKBONE.intakeCompleted, label: "Intake completed", order: 4, required: true, terminal: false },
    { id: PIPELINE_BACKBONE.clientActivated, label: "Client activated", order: 5, required: true, terminal: true },
  ],
};

export type PipelineReasonCode =
  | "PL_OK"
  | "PL_REVERSED"
  | "PL_UNKNOWN_STAGE"
  | "PL_SAME_STAGE"
  | "PL_REQUIRED_STAGE_SKIPPED"
  | "PL_TERMINAL_STAGE"
  | "PL_REVERSAL_NOT_ALLOWED"
  | "PL_INVALID_DEFINITION";

export interface PipelineTransitionResult {
  allowed: boolean;
  fromStageId: string;
  toStageId: string;
  reasonCode: PipelineReasonCode;
  ruleVersion: string;
  /** Required stage ids that the attempted move would skip (deny evidence). */
  skippedRequiredStageIds: string[];
}

/** Structural validation of a pipeline definition. Empty array = valid. */
export function validatePipelineDefinition(def: PipelineDefinition): string[] {
  const errors: string[] = [];
  if (def.stages.length < 2) errors.push("pipeline needs at least two stages");
  const ids = def.stages.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push("stage ids must be unique");
  const orders = def.stages.map((s) => s.order);
  if (new Set(orders).size !== orders.length) errors.push("stage orders must be unique");
  const sorted = [...def.stages].sort((a, b) => a.order - b.order);
  const terminals = def.stages.filter((s) => s.terminal);
  if (terminals.length !== 1) errors.push("exactly one terminal stage is required");
  const last = sorted[sorted.length - 1];
  if (terminals.length === 1 && last && !last.terminal) errors.push("the terminal stage must be last in order");
  if (terminals.length === 1 && terminals[0] && !terminals[0].required) errors.push("the terminal stage must be required");
  return errors;
}

export interface PipelineTransitionOptions {
  /**
   * Staff correction moving backward to an earlier stage. Allowed but
   * flagged (PL_REVERSED) so the audit trail records it; never silent.
   */
  reversal?: boolean;
}

export function pipelineTransition(
  def: PipelineDefinition,
  fromStageId: string,
  toStageId: string,
  options: PipelineTransitionOptions = {},
): PipelineTransitionResult {
  const base = {
    fromStageId,
    toStageId,
    ruleVersion: PIPELINE_RULES_VERSION,
    skippedRequiredStageIds: [] as string[],
  };
  if (validatePipelineDefinition(def).length > 0) {
    return { ...base, allowed: false, reasonCode: "PL_INVALID_DEFINITION" };
  }
  const stages = [...def.stages].sort((a, b) => a.order - b.order);
  const from = stages.find((s) => s.id === fromStageId);
  const to = stages.find((s) => s.id === toStageId);
  if (!from || !to) return { ...base, allowed: false, reasonCode: "PL_UNKNOWN_STAGE" };
  if (from.id === to.id) return { ...base, allowed: false, reasonCode: "PL_SAME_STAGE" };
  if (from.terminal) return { ...base, allowed: false, reasonCode: "PL_TERMINAL_STAGE" };

  if (to.order < from.order) {
    return options.reversal
      ? { ...base, allowed: true, reasonCode: "PL_REVERSED" }
      : { ...base, allowed: false, reasonCode: "PL_REVERSAL_NOT_ALLOWED" };
  }

  const skippedRequired = stages
    .filter((s) => s.order > from.order && s.order < to.order && s.required)
    .map((s) => s.id);
  if (skippedRequired.length > 0) {
    return {
      ...base,
      allowed: false,
      reasonCode: "PL_REQUIRED_STAGE_SKIPPED",
      skippedRequiredStageIds: skippedRequired,
    };
  }
  return { ...base, allowed: true, reasonCode: "PL_OK" };
}

/** The forward stage the record should reach next; null once terminal. */
export function nextRequiredStage(
  def: PipelineDefinition,
  currentStageId: string,
): PipelineStageDefinition | null {
  const stages = [...def.stages].sort((a, b) => a.order - b.order);
  const current = stages.find((s) => s.id === currentStageId);
  if (!current || current.terminal) return null;
  return stages.find((s) => s.order > current.order && s.required) ?? null;
}
