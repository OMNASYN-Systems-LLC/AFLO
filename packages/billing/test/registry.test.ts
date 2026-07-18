import { describe, expect, it } from "vitest";
import { BILLING_RULE_REGISTRY, getBillingRule } from "../src/registry";
import { BILLING_RULES_VERSION } from "../src/transitions";

describe("billing rule registry", () => {
  it("carries complete metadata for every rule", () => {
    for (const rule of BILLING_RULE_REGISTRY) {
      expect(rule.id).toMatch(/^billing\.[a-z_]+$/);
      expect(rule.version).toBe(BILLING_RULES_VERSION);
      expect(Date.parse(rule.effectiveDate)).not.toBeNaN();
      expect(rule.description.length).toBeGreaterThan(20);
      expect(rule.inputs.length).toBeGreaterThan(0);
      expect(rule.output.length).toBeGreaterThan(0);
      expect(rule.changeHistory.at(-1)?.version).toBe(rule.version);
    }
  });

  it("has unique stable identifiers", () => {
    const ids = BILLING_RULE_REGISTRY.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("looks rules up by id", () => {
    expect(getBillingRule("billing.subscription_entitlement")?.reasonCodes).toContain("ENT_PAST_DUE_IN_GRACE");
    expect(getBillingRule("nope")).toBeUndefined();
  });
});
