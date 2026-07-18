import { describe, expect, it } from "vitest";
import { DEFAULT_PAST_DUE_GRACE_DAYS, evaluateEntitlement } from "../src/entitlement";
import { BILLING_RULES_VERSION } from "../src/transitions";

const NOW = new Date("2026-07-18T12:00:00Z");
const day = 86_400_000;

describe("evaluateEntitlement", () => {
  it("entitles active and trialing subscriptions", () => {
    expect(evaluateEntitlement({ status: "active", now: NOW })).toMatchObject({
      entitled: true,
      reasonCode: "ENT_ACTIVE",
      ruleVersion: BILLING_RULES_VERSION,
    });
    expect(evaluateEntitlement({ status: "trialing", now: NOW })).toMatchObject({
      entitled: true,
      reasonCode: "ENT_TRIALING",
    });
  });

  it("withdraws access for paused and canceled", () => {
    expect(evaluateEntitlement({ status: "paused", now: NOW })).toMatchObject({ entitled: false, reasonCode: "ENT_PAUSED" });
    expect(evaluateEntitlement({ status: "canceled", now: NOW })).toMatchObject({ entitled: false, reasonCode: "ENT_CANCELED" });
  });

  it("keeps past_due entitled within the grace window, then withdraws", () => {
    const within = new Date(NOW.getTime() - (DEFAULT_PAST_DUE_GRACE_DAYS - 1) * day).toISOString();
    const expired = new Date(NOW.getTime() - (DEFAULT_PAST_DUE_GRACE_DAYS + 1) * day).toISOString();
    expect(evaluateEntitlement({ status: "past_due", pastDueSinceIso: within, now: NOW })).toMatchObject({
      entitled: true,
      reasonCode: "ENT_PAST_DUE_IN_GRACE",
    });
    expect(evaluateEntitlement({ status: "past_due", pastDueSinceIso: expired, now: NOW })).toMatchObject({
      entitled: false,
      reasonCode: "ENT_PAST_DUE_EXPIRED",
    });
  });

  it("treats a past_due subscription with no recorded start as still in grace", () => {
    expect(evaluateEntitlement({ status: "past_due", now: NOW })).toMatchObject({
      entitled: true,
      reasonCode: "ENT_PAST_DUE_IN_GRACE",
    });
  });

  it("respects a custom grace period", () => {
    const since = new Date(NOW.getTime() - 2 * day).toISOString();
    expect(evaluateEntitlement({ status: "past_due", pastDueSinceIso: since, now: NOW, graceDays: 1 }).entitled).toBe(false);
    expect(evaluateEntitlement({ status: "past_due", pastDueSinceIso: since, now: NOW, graceDays: 3 }).entitled).toBe(true);
  });

  it("rejects an unparseable past-due timestamp", () => {
    expect(() => evaluateEntitlement({ status: "past_due", pastDueSinceIso: "nope", now: NOW })).toThrow(TypeError);
  });
});
