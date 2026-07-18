import { describe, expect, it } from "vitest";
import { MockPortalRepository } from "../src/repositories/mock";
import { syntheticDatabase, type SyntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-17T15:00:00Z");

describe("MockPortalRepository — published-only projection", () => {
  it("projects the demo client's published material and cleared assessment", async () => {
    const repo = new MockPortalRepository();
    const view = await repo.getPortalView(ORG, "c-bell", NOW);
    expect(view).not.toBeNull();
    expect(view!.clientFirstName).toBe("Marcus");
    expect(view!.stage).toMatchObject({ label: "Recovery" });
    expect(view!.stage?.focus).toContain("autopay");
    expect(view!.roadmap?.title).toBe("Recovery: collections resolved, payments current");
    expect(view!.roadmap?.milestones.length).toBeGreaterThan(0);
    expect(view!.monthlyActions.length).toBeGreaterThan(0);
    expect(view!.publishedReports.map((r) => r.quarter)).toEqual(["2026-Q2"]);
    expect(view!.nextAppointment?.purpose).toBe("Collections arrangement follow-up");
  });

  it("never surfaces draft or under-review reports", async () => {
    const repo = new MockPortalRepository();
    // Tanya Okafor's only report is a Q2 draft; Renee Solomon's is ready_for_review.
    const okafor = await repo.getPortalView(ORG, "c-okafor", NOW);
    expect(okafor!.publishedReports).toEqual([]);
    const solomon = await repo.getPortalView(ORG, "c-solomon", NOW);
    expect(solomon!.publishedReports).toEqual([]);
  });

  it("never surfaces non-published roadmaps", async () => {
    const repo = new MockPortalRepository();
    // Devon Pryor's roadmap is a draft; Sofia Ramirez's is in staff review.
    expect((await repo.getPortalView(ORG, "c-pryor", NOW))!.roadmap).toBeNull();
    expect((await repo.getPortalView(ORG, "c-ramirez", NOW))!.roadmap).toBeNull();
  });

  it("hides assessments awaiting human review, falling back to the last cleared one", async () => {
    const seed: SyntheticDatabase = structuredClone(syntheticDatabase);
    seed.assessments.push({
      id: "ra-bell-flagged",
      clientId: "c-bell",
      stage: "acquisition",
      previousStage: "recovery",
      ruleVersion: "readiness.v1.0.0",
      reasonCodes: ["RC_ALL_ACQUISITION_GATES_MET"],
      factsUsed: [],
      proposedNextAction: "x",
      requiresHumanReview: true,
      reviewReasonCodes: ["RV_MULTI_STAGE_ADVANCE"],
      assessedAt: "2026-07-16T00:00:00.000Z",
      actorStaffId: "s-boyd",
    });
    const view = await new MockPortalRepository(seed).getPortalView(ORG, "c-bell", NOW);
    expect(view!.stage?.label).toBe("Recovery"); // the flagged acquisition result stays internal
  });

  it("fails closed for leads, foreign orgs, and unknown ids", async () => {
    const repo = new MockPortalRepository();
    expect(await repo.getPortalView(ORG, "l-haddad", NOW)).toBeNull();
    expect(await repo.getPortalView("org-other", "c-bell", NOW)).toBeNull();
    expect(await repo.getPortalView(ORG, "c-nobody", NOW)).toBeNull();
  });
});
