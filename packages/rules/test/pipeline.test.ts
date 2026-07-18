import { describe, expect, it } from "vitest";
import {
  DEFAULT_PIPELINE,
  nextRequiredStage,
  PIPELINE_RULES_VERSION,
  pipelineTransition,
  validatePipelineDefinition,
  type PipelineDefinition,
} from "../src/pipeline";

/** Default pipeline plus an optional nurture stage between contact points. */
const WITH_OPTIONAL: PipelineDefinition = {
  id: "custom",
  version: PIPELINE_RULES_VERSION,
  stages: [
    { id: "new_lead", label: "New lead", order: 1, required: true, terminal: false },
    { id: "nurture", label: "Nurture", order: 2, required: false, terminal: false },
    { id: "consultation_scheduled", label: "Consult", order: 3, required: true, terminal: false },
    { id: "intake_started", label: "Intake started", order: 4, required: true, terminal: false },
    { id: "intake_completed", label: "Intake completed", order: 5, required: true, terminal: false },
    { id: "client_activated", label: "Activated", order: 6, required: true, terminal: true },
  ],
};

describe("validatePipelineDefinition", () => {
  it("accepts the default and custom pipelines", () => {
    expect(validatePipelineDefinition(DEFAULT_PIPELINE)).toEqual([]);
    expect(validatePipelineDefinition(WITH_OPTIONAL)).toEqual([]);
  });

  it("rejects duplicate ids/orders, missing terminal, and misplaced terminal", () => {
    const dupId = { ...DEFAULT_PIPELINE, stages: DEFAULT_PIPELINE.stages.map((s, i) => (i === 1 ? { ...s, id: "new_lead" } : s)) };
    expect(validatePipelineDefinition(dupId)).toContainEqual(expect.stringContaining("unique"));
    const noTerminal = { ...DEFAULT_PIPELINE, stages: DEFAULT_PIPELINE.stages.map((s) => ({ ...s, terminal: false })) };
    expect(validatePipelineDefinition(noTerminal)).toContainEqual(expect.stringContaining("terminal"));
    const midTerminal = {
      ...DEFAULT_PIPELINE,
      stages: DEFAULT_PIPELINE.stages.map((s) => ({ ...s, terminal: s.id === "intake_started" })),
    };
    expect(validatePipelineDefinition(midTerminal)).toContainEqual(expect.stringContaining("last in order"));
  });
});

describe("pipelineTransition — founder-required path", () => {
  it("allows each consecutive required step", () => {
    const path = ["new_lead", "consultation_scheduled", "intake_started", "intake_completed", "client_activated"];
    for (let i = 0; i < path.length - 1; i++) {
      const res = pipelineTransition(DEFAULT_PIPELINE, path[i]!, path[i + 1]!);
      expect(res).toMatchObject({ allowed: true, reasonCode: "PL_OK", ruleVersion: PIPELINE_RULES_VERSION });
    }
  });

  it("never silently skips a required stage", () => {
    const res = pipelineTransition(DEFAULT_PIPELINE, "new_lead", "client_activated");
    expect(res.allowed).toBe(false);
    expect(res.reasonCode).toBe("PL_REQUIRED_STAGE_SKIPPED");
    expect(res.skippedRequiredStageIds).toEqual(["consultation_scheduled", "intake_started", "intake_completed"]);
  });

  it("allows skipping only optional stages", () => {
    expect(pipelineTransition(WITH_OPTIONAL, "new_lead", "consultation_scheduled")).toMatchObject({
      allowed: true,
      reasonCode: "PL_OK",
    });
    expect(pipelineTransition(WITH_OPTIONAL, "new_lead", "intake_started").reasonCode).toBe(
      "PL_REQUIRED_STAGE_SKIPPED",
    );
  });

  it("treats activation as terminal", () => {
    expect(pipelineTransition(DEFAULT_PIPELINE, "client_activated", "new_lead", { reversal: true }).reasonCode).toBe(
      "PL_TERMINAL_STAGE",
    );
  });
});

describe("pipelineTransition — corrections and errors", () => {
  it("flags backward moves as explicit reversals, never silent", () => {
    expect(pipelineTransition(DEFAULT_PIPELINE, "intake_started", "consultation_scheduled").reasonCode).toBe(
      "PL_REVERSAL_NOT_ALLOWED",
    );
    const reversed = pipelineTransition(DEFAULT_PIPELINE, "intake_started", "consultation_scheduled", {
      reversal: true,
    });
    expect(reversed).toMatchObject({ allowed: true, reasonCode: "PL_REVERSED" });
  });

  it("rejects unknown and same-stage moves and invalid definitions", () => {
    expect(pipelineTransition(DEFAULT_PIPELINE, "new_lead", "nope").reasonCode).toBe("PL_UNKNOWN_STAGE");
    expect(pipelineTransition(DEFAULT_PIPELINE, "new_lead", "new_lead").reasonCode).toBe("PL_SAME_STAGE");
    const invalid = { ...DEFAULT_PIPELINE, stages: [] };
    expect(pipelineTransition(invalid, "a", "b").reasonCode).toBe("PL_INVALID_DEFINITION");
  });
});

describe("nextRequiredStage", () => {
  it("walks the required backbone and ends at terminal", () => {
    expect(nextRequiredStage(DEFAULT_PIPELINE, "new_lead")?.id).toBe("consultation_scheduled");
    expect(nextRequiredStage(WITH_OPTIONAL, "new_lead")?.id).toBe("consultation_scheduled");
    expect(nextRequiredStage(DEFAULT_PIPELINE, "intake_completed")?.id).toBe("client_activated");
    expect(nextRequiredStage(DEFAULT_PIPELINE, "client_activated")).toBeNull();
    expect(nextRequiredStage(DEFAULT_PIPELINE, "nope")).toBeNull();
  });
});
