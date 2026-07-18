import { describe, expect, it } from "vitest";
import { assessEngagement, ENGAGEMENT_RULES_VERSION } from "../src/engagement";

const NOW = new Date("2026-07-17T15:00:00Z");

function daysAgo(days: number): string {
  return new Date(NOW.getTime() - days * 86_400_000).toISOString();
}

describe("assessEngagement thresholds", () => {
  it.each([
    [0, "active"],
    [13, "active"],
    [14, "cooling"],
    [29, "cooling"],
    [30, "at_risk"],
    [59, "at_risk"],
    [60, "dormant"],
    [400, "dormant"],
  ] as const)("%i days since activity → %s", (days, expected) => {
    const result = assessEngagement(daysAgo(days), NOW);
    expect(result.status).toBe(expected);
    expect(result.daysSinceLastActivity).toBe(days);
    expect(result.ruleVersion).toBe(ENGAGEMENT_RULES_VERSION);
  });

  it("clamps future activity timestamps to zero days", () => {
    const result = assessEngagement(daysAgo(-3), NOW);
    expect(result.daysSinceLastActivity).toBe(0);
    expect(result.status).toBe("active");
  });

  it("rejects unparseable timestamps instead of guessing a status", () => {
    expect(() => assessEngagement("", NOW)).toThrow(TypeError);
    expect(() => assessEngagement("not-a-date", NOW)).toThrow(/invalid lastActivityAt/);
  });
});
