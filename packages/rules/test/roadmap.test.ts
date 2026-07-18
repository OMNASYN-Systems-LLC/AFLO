import { describe, expect, it } from "vitest";
import {
  ROADMAP_RULES_VERSION,
  ROADMAP_STATUSES,
  roadmapTransition,
  roadmapTransitionsFrom,
} from "../src/roadmap";

describe("roadmapTransition", () => {
  it("allows the founder-required forward path with naming reason codes", () => {
    expect(roadmapTransition("draft", "staff_review")).toMatchObject({
      allowed: true,
      reasonCode: "RM_SUBMITTED",
      ruleVersion: ROADMAP_RULES_VERSION,
    });
    expect(roadmapTransition("staff_review", "approved").reasonCode).toBe("RM_APPROVED");
    expect(roadmapTransition("approved", "published").reasonCode).toBe("RM_PUBLISHED");
  });

  it("allows explicit returns, reopens, and archival", () => {
    expect(roadmapTransition("staff_review", "draft").reasonCode).toBe("RM_RETURNED");
    expect(roadmapTransition("approved", "draft").reasonCode).toBe("RM_REOPENED");
    expect(roadmapTransition("draft", "archived").reasonCode).toBe("RM_ARCHIVED");
    expect(roadmapTransition("published", "archived").reasonCode).toBe("RM_ARCHIVED");
  });

  it("denies skipping review or publication steps", () => {
    expect(roadmapTransition("draft", "approved")).toMatchObject({
      allowed: false,
      reasonCode: "RM_ILLEGAL_TRANSITION",
    });
    expect(roadmapTransition("draft", "published").allowed).toBe(false);
    expect(roadmapTransition("staff_review", "published").allowed).toBe(false);
    expect(roadmapTransition("published", "draft").allowed).toBe(false);
  });

  it("denies same-status, unknown statuses, and any move out of archived", () => {
    expect(roadmapTransition("draft", "draft").reasonCode).toBe("RM_SAME_STATUS");
    expect(roadmapTransition("draft", "live").reasonCode).toBe("RM_UNKNOWN_STATUS");
    expect(roadmapTransition("deleted", "draft").reasonCode).toBe("RM_UNKNOWN_STATUS");
    for (const to of ROADMAP_STATUSES.filter((s) => s !== "archived")) {
      expect(roadmapTransition("archived", to).allowed).toBe(false);
    }
  });

  it("exposes only legal targets for UI action rendering", () => {
    expect(roadmapTransitionsFrom("draft").sort()).toEqual(["archived", "staff_review"]);
    expect(roadmapTransitionsFrom("staff_review").sort()).toEqual(["approved", "draft"]);
    expect(roadmapTransitionsFrom("approved").sort()).toEqual(["draft", "published"]);
    expect(roadmapTransitionsFrom("archived")).toEqual([]);
  });
});
