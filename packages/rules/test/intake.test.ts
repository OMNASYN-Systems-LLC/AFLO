import { describe, expect, it } from "vitest";
import {
  DEFAULT_INTAKE,
  INTAKE_RULES_VERSION,
  intakeCompleteness,
  sectionCompletion,
  validateIntakeDefinition,
  type IntakeDefinition,
} from "../src/intake";

const ALL_REQUIRED_IDS = DEFAULT_INTAKE.sections.filter((s) => s.required).map((s) => s.id);

describe("validateIntakeDefinition", () => {
  it("accepts the founder-required default definition", () => {
    expect(validateIntakeDefinition(DEFAULT_INTAKE)).toEqual([]);
  });

  it("rejects empty, duplicate-id, duplicate-order, and all-optional definitions", () => {
    expect(validateIntakeDefinition({ id: "x", version: "v", sections: [] })).not.toEqual([]);
    const dupId: IntakeDefinition = {
      id: "x",
      version: "v",
      sections: [
        { id: "a", label: "A", order: 1, required: true },
        { id: "a", label: "A2", order: 2, required: true },
      ],
    };
    expect(validateIntakeDefinition(dupId)).toContain("section ids must be unique");
    const dupOrder: IntakeDefinition = {
      id: "x",
      version: "v",
      sections: [
        { id: "a", label: "A", order: 1, required: true },
        { id: "b", label: "B", order: 1, required: true },
      ],
    };
    expect(validateIntakeDefinition(dupOrder)).toContain("section orders must be unique");
    const allOptional: IntakeDefinition = {
      id: "x",
      version: "v",
      sections: [{ id: "a", label: "A", order: 1, required: false }],
    };
    expect(validateIntakeDefinition(allOptional)).toContain("at least one section must be required");
  });
});

describe("sectionCompletion", () => {
  it("allows completing a known, not-yet-complete section", () => {
    const res = sectionCompletion(DEFAULT_INTAKE, ["identity"], "consent");
    expect(res).toMatchObject({ allowed: true, reasonCode: "IN_OK", ruleVersion: INTAKE_RULES_VERSION });
  });

  it("denies unknown sections and double completion", () => {
    expect(sectionCompletion(DEFAULT_INTAKE, [], "ssn_capture")).toMatchObject({
      allowed: false,
      reasonCode: "IN_UNKNOWN_SECTION",
    });
    expect(sectionCompletion(DEFAULT_INTAKE, ["identity"], "identity")).toMatchObject({
      allowed: false,
      reasonCode: "IN_SECTION_ALREADY_COMPLETE",
    });
  });

  it("fails closed on an invalid definition", () => {
    const bad: IntakeDefinition = { id: "x", version: "v", sections: [] };
    expect(sectionCompletion(bad, [], "identity").reasonCode).toBe("IN_INVALID_DEFINITION");
  });
});

describe("intakeCompleteness", () => {
  it("reports missing required sections with counts", () => {
    const res = intakeCompleteness(DEFAULT_INTAKE, ["identity", "consent"]);
    expect(res.complete).toBe(false);
    expect(res.reasonCode).toBe("IN_MISSING_REQUIRED");
    expect(res.completedRequiredCount).toBe(2);
    expect(res.requiredCount).toBe(ALL_REQUIRED_IDS.length);
    expect(res.missingRequiredSectionIds).toEqual(
      ALL_REQUIRED_IDS.filter((id) => id !== "identity" && id !== "consent"),
    );
  });

  it("completes when all required sections are complete, optional ones outstanding", () => {
    const res = intakeCompleteness(DEFAULT_INTAKE, ALL_REQUIRED_IDS);
    expect(res).toMatchObject({ complete: true, reasonCode: "IN_COMPLETE" });
    expect(res.missingRequiredSectionIds).toEqual([]);
  });

  it("fails closed when completed ids are not in the definition", () => {
    const res = intakeCompleteness(DEFAULT_INTAKE, [...ALL_REQUIRED_IDS, "mystery"]);
    expect(res.complete).toBe(false);
    expect(res.reasonCode).toBe("IN_UNKNOWN_SECTION");
    expect(res.unknownSectionIds).toEqual(["mystery"]);
  });

  it("fails closed on an invalid definition", () => {
    const bad: IntakeDefinition = { id: "x", version: "v", sections: [] };
    expect(intakeCompleteness(bad, []).reasonCode).toBe("IN_INVALID_DEFINITION");
  });
});
