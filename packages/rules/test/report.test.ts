import { describe, expect, it } from "vitest";
import { quarterMonths, quarterOf, REPORT_RULES_VERSION, reportTransition } from "../src/report";

describe("reportTransition", () => {
  it("allows the review path with naming reason codes", () => {
    expect(reportTransition("draft", "ready_for_review")).toMatchObject({
      allowed: true,
      reasonCode: "RP_SUBMITTED",
      ruleVersion: REPORT_RULES_VERSION,
    });
    expect(reportTransition("ready_for_review", "published").reasonCode).toBe("RP_PUBLISHED");
    expect(reportTransition("ready_for_review", "draft").reasonCode).toBe("RP_RETURNED");
  });

  it("denies skipping review and any edit of a published report", () => {
    expect(reportTransition("draft", "published")).toMatchObject({
      allowed: false,
      reasonCode: "RP_ILLEGAL_TRANSITION",
    });
    expect(reportTransition("published", "draft").allowed).toBe(false);
    expect(reportTransition("published", "ready_for_review").allowed).toBe(false);
  });

  it("denies same-status and unknown statuses", () => {
    expect(reportTransition("draft", "draft").reasonCode).toBe("RP_SAME_STATUS");
    expect(reportTransition("draft", "delivered").reasonCode).toBe("RP_UNKNOWN_STATUS");
  });
});

describe("quarter helpers", () => {
  it("derives the calendar quarter deterministically (UTC)", () => {
    expect(quarterOf(new Date("2026-01-15T00:00:00Z"))).toBe("2026-Q1");
    expect(quarterOf(new Date("2026-07-18T12:00:00Z"))).toBe("2026-Q3");
    expect(quarterOf(new Date("2026-12-31T23:59:59Z"))).toBe("2026-Q4");
  });

  it("expands a quarter to its months and rejects malformed input", () => {
    expect(quarterMonths("2026-Q3")).toEqual(["2026-07", "2026-08", "2026-09"]);
    expect(quarterMonths("2026-Q1")).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(quarterMonths("2026-Q5")).toEqual([]);
    expect(quarterMonths("nonsense")).toEqual([]);
  });
});
