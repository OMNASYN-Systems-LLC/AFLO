import { describe, expect, it } from "vitest";
import { ACTION_RULES_VERSION } from "../src/action";
import { DOCUMENT_RULES_VERSION } from "../src/document";
import { ENGAGEMENT_RULES_VERSION } from "../src/engagement";
import { INTAKE_RULES_VERSION } from "../src/intake";
import { MESSAGING_RULES_VERSION } from "../src/messaging";
import { PIPELINE_RULES_VERSION } from "../src/pipeline";
import { READINESS_RULES_VERSION, REASON_CODE_DESCRIPTIONS } from "../src/readiness";
import { RESOLUTION_RULES_VERSION } from "../src/resolution";
import { REPORT_RULES_VERSION } from "../src/report";
import { ROUNDUP_RULES_VERSION } from "../src/roundup";
import { REVIEW_REASON_DESCRIPTIONS, REVIEW_RULES_VERSION } from "../src/review";
import { ROADMAP_RULES_VERSION } from "../src/roadmap";
import { getRule, RULE_REGISTRY } from "../src/registry";

describe("rule registry", () => {
  it("carries complete charter metadata for every rule", () => {
    for (const rule of RULE_REGISTRY) {
      expect(rule.id).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(rule.version).toMatch(/^[a-z]+\.v\d+\.\d+\.\d+$/);
      expect(Date.parse(rule.effectiveDate)).not.toBeNaN();
      expect(rule.description.length).toBeGreaterThan(20);
      expect(rule.inputs.length).toBeGreaterThan(0);
      expect(rule.output.length).toBeGreaterThan(0);
      expect(rule.changeHistory.length).toBeGreaterThan(0);
      const latest = rule.changeHistory[rule.changeHistory.length - 1];
      expect(latest?.version).toBe(rule.version);
    }
  });

  it("has unique stable identifiers", () => {
    const ids = RULE_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("stays in lockstep with implementation version constants", () => {
    expect(getRule("readiness.stage")?.version).toBe(READINESS_RULES_VERSION);
    expect(getRule("readiness.utilization")?.version).toBe(READINESS_RULES_VERSION);
    expect(getRule("pipeline.transition")?.version).toBe(PIPELINE_RULES_VERSION);
    expect(getRule("intake.completeness")?.version).toBe(INTAKE_RULES_VERSION);
    expect(getRule("readiness.review_gate")?.version).toBe(REVIEW_RULES_VERSION);
    expect(getRule("roadmap.transition")?.version).toBe(ROADMAP_RULES_VERSION);
    expect(getRule("action.transition")?.version).toBe(ACTION_RULES_VERSION);
    expect(getRule("report.transition")?.version).toBe(REPORT_RULES_VERSION);
    expect(getRule("document.transition")?.version).toBe(DOCUMENT_RULES_VERSION);
    expect(getRule("roundup.calculator")?.version).toBe(ROUNDUP_RULES_VERSION);
    expect(getRule("engagement.status")?.version).toBe(ENGAGEMENT_RULES_VERSION);
    expect(getRule("resolution.input_completeness")?.version).toBe(RESOLUTION_RULES_VERSION);
    expect(getRule("messaging.thread")?.version).toBe(MESSAGING_RULES_VERSION);
  });

  it("registers every review reason code", () => {
    expect(getRule("readiness.review_gate")?.reasonCodes.sort()).toEqual(
      Object.keys(REVIEW_REASON_DESCRIPTIONS).sort(),
    );
  });

  it("registers every readiness reason code", () => {
    expect(getRule("readiness.stage")?.reasonCodes.sort()).toEqual(
      Object.keys(REASON_CODE_DESCRIPTIONS).sort(),
    );
  });
});
