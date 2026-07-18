import { describe, expect, it } from "vitest";
import { ENGAGEMENT_RULES_VERSION } from "../src/engagement";
import { READINESS_RULES_VERSION, REASON_CODE_DESCRIPTIONS } from "../src/readiness";
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
    expect(getRule("engagement.status")?.version).toBe(ENGAGEMENT_RULES_VERSION);
  });

  it("registers every readiness reason code", () => {
    expect(getRule("readiness.stage")?.reasonCodes.sort()).toEqual(
      Object.keys(REASON_CODE_DESCRIPTIONS).sort(),
    );
  });
});
