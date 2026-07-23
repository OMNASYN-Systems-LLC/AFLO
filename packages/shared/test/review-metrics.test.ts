import { describe, expect, it } from "vitest";
import {
  reviewMetricsFor,
  type ActionOutcomeMetricInput,
  type ReviewDecisionMetricInput,
  type ReviewItemMetricInput,
} from "../src/store/review-metrics";

/**
 * Workstream A PR-3 — the analytics derivations, proven on synthetic records.
 * The contract under test: rates are null (never 0) on empty denominators,
 * medians are exact, orphans/malformed rows are excluded rather than
 * misattributed, and everything is computed — nothing stored.
 */

function item(overrides: Partial<ReviewItemMetricInput> & { id: string }): ReviewItemMetricInput {
  return {
    artifactType: "roadmap_draft",
    state: "published",
    playbookId: null,
    playbookVersion: null,
    submittedAtIso: "2026-07-22T10:00:00.000Z",
    publishedAtIso: null,
    ...overrides,
  };
}

function decision(
  overrides: Partial<ReviewDecisionMetricInput> & { reviewItemId: string },
): ReviewDecisionMetricInput {
  return {
    decision: "approved_unchanged",
    reviewerMemberId: "m1",
    submittedAtIso: "2026-07-22T10:00:00.000Z",
    decidedAtIso: "2026-07-22T10:30:00.000Z",
    modifiedFieldCount: 0,
    ...overrides,
  };
}

function action(overrides: Partial<ActionOutcomeMetricInput> = {}): ActionOutcomeMetricInput {
  return { reviewItemId: null, playbookId: null, playbookVersion: null, completed: false, advancedToStage: null, ...overrides };
}

describe("reviewMetricsFor — empty and degenerate inputs", () => {
  it("reports null rates (never 0%) when there is no data", () => {
    const metrics = reviewMetricsFor([], [], []);
    expect(metrics.overall).toMatchObject({
      total: 0,
      approvalRate: null,
      editRate: null,
      rejectionRate: null,
      medianReviewMinutes: null,
      meanModifiedFields: null,
    });
    expect(metrics.actionCompletionRate).toBeNull();
    expect(metrics.escalationVolume).toBe(0);
    expect(metrics.staffProfiles).toEqual([]);
    expect(metrics.playbookEffectiveness).toEqual([]);
  });

  it("excludes orphan decisions from artifact-type mixes rather than misattributing them", () => {
    const metrics = reviewMetricsFor([], [decision({ reviewItemId: "ghost" })], []);
    expect(metrics.byArtifactType).toEqual({});
    expect(metrics.overall.total).toBe(1); // still counted overall
  });

  it("excludes malformed timestamps from the median instead of treating them as 0 minutes", () => {
    const items = [item({ id: "i1" })];
    const metrics = reviewMetricsFor(
      items,
      [
        decision({ reviewItemId: "i1", decidedAtIso: "not-a-date" }),
        decision({ reviewItemId: "i1", decidedAtIso: "2026-07-22T10:10:00.000Z" }),
      ],
      [],
    );
    expect(metrics.overall.medianReviewMinutes).toBe(10);
  });
});

describe("reviewMetricsFor — decision mixes", () => {
  const items = [item({ id: "i1" }), item({ id: "i2", artifactType: "quarterly_report" })];
  const decisions = [
    decision({ reviewItemId: "i1", decision: "approved_unchanged", decidedAtIso: "2026-07-22T10:10:00.000Z" }),
    decision({
      reviewItemId: "i1",
      decision: "approved_with_edits",
      modifiedFieldCount: 3,
      reviewerMemberId: "m2",
      decidedAtIso: "2026-07-22T10:20:00.000Z",
    }),
    decision({ reviewItemId: "i2", decision: "rejected", decidedAtIso: "2026-07-22T10:40:00.000Z" }),
    decision({ reviewItemId: "i2", decision: "escalated", reviewerMemberId: "m2", decidedAtIso: "2026-07-22T11:00:00.000Z" }),
  ];

  it("computes rates, medians, and escalation volume exactly", () => {
    const metrics = reviewMetricsFor(items, decisions, []);
    expect(metrics.overall).toMatchObject({
      total: 4,
      approvedUnchanged: 1,
      approvedWithEdits: 1,
      rejected: 1,
      escalated: 1,
      approvalRate: 0.5,
      editRate: 0.5,
      rejectionRate: 0.25,
      meanModifiedFields: 3,
    });
    // Times: 10, 20, 40, 60 minutes → median (20+40)/2 = 30.
    expect(metrics.overall.medianReviewMinutes).toBe(30);
    expect(metrics.escalationVolume).toBe(1);
  });

  it("groups by artifact type and by reviewer (sorted, deterministic)", () => {
    const metrics = reviewMetricsFor(items, decisions, []);
    expect(metrics.byArtifactType.roadmap_draft?.total).toBe(2);
    expect(metrics.byArtifactType.quarterly_report?.total).toBe(2);
    expect(metrics.byArtifactType.quarterly_report?.rejectionRate).toBe(0.5);
    expect(metrics.staffProfiles.map((p) => p.reviewerMemberId)).toEqual(["m1", "m2"]);
    expect(metrics.staffProfiles[0]).toMatchObject({ total: 2, approvedUnchanged: 1, rejected: 1 });
    expect(metrics.staffProfiles[1]).toMatchObject({ total: 2, approvedWithEdits: 1, escalated: 1 });
  });

  it("counts queue depth from item state", () => {
    const metrics = reviewMetricsFor(
      [item({ id: "a", state: "awaiting_review" }), item({ id: "b", state: "awaiting_review" }), item({ id: "c" })],
      [],
      [],
    );
    expect(metrics.awaitingReviewCount).toBe(2);
  });
});

describe("reviewMetricsFor — actions, outcomes, playbook effectiveness", () => {
  it("computes completion + stage-advancement across actions", () => {
    const metrics = reviewMetricsFor(
      [],
      [],
      [
        action({ completed: true, advancedToStage: "credit_readiness" }),
        action({ completed: true }),
        action({ completed: false }),
      ],
    );
    expect(metrics.actionCompletionRate).toBeCloseTo(2 / 3);
    expect(metrics.stageAdvancementCount).toBe(1);
  });

  it("groups playbook effectiveness by (playbookId, version) with null-safe rates", () => {
    const pb = { playbookId: "pb-1", playbookVersion: "1.0.0" };
    const metrics = reviewMetricsFor(
      [
        item({ id: "i1", ...pb, state: "published" }),
        item({ id: "i2", ...pb, state: "awaiting_review" }),
        item({ id: "i3", playbookId: "pb-1", playbookVersion: "1.1.0" }),
      ],
      [],
      [
        action({ ...pb, completed: true, advancedToStage: "stabilization" }),
        action({ ...pb, completed: true }),
        action({ ...pb, completed: false }),
      ],
    );
    expect(metrics.playbookEffectiveness).toHaveLength(2);
    const v1 = metrics.playbookEffectiveness.find((p) => p.playbookVersion === "1.0.0")!;
    expect(v1).toMatchObject({
      playbookId: "pb-1",
      itemCount: 2,
      publishedCount: 1,
      actionCount: 3,
    });
    expect(v1.actionCompletionRate).toBeCloseTo(2 / 3);
    expect(v1.stageAdvancementRate).toBe(0.5); // 1 of 2 completed advanced
    const v11 = metrics.playbookEffectiveness.find((p) => p.playbookVersion === "1.1.0")!;
    expect(v11).toMatchObject({ itemCount: 1, actionCount: 0, actionCompletionRate: null, stageAdvancementRate: null });
  });

  it("actions without a playbook contribute to overall rates but no effectiveness row", () => {
    const metrics = reviewMetricsFor([], [], [action({ completed: true })]);
    expect(metrics.actionCompletionRate).toBe(1);
    expect(metrics.playbookEffectiveness).toEqual([]);
  });
});
