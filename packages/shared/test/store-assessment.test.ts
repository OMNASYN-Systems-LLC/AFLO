import { describe, expect, it } from "vitest";
import { REASON_CODE_NEXT_ACTIONS } from "@aflo/rules";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase, type SyntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore(seed: SyntheticDatabase = syntheticDatabase) {
  return new AfloStore(seed, () => NOW);
}

describe("runReadinessAssessment — success", () => {
  it("records the assessment with previous stage, next action, event, and audit", () => {
    const store = makeStore();
    // Whitaker's seeded history ends at capital_readiness; current facts assess to acquisition.
    const res = store.runReadinessAssessment({
      organizationId: ORG,
      clientId: "c-whitaker",
      actorStaffId: "s-boyd",
    });
    expect(res.ok).toBe(true);
    expect(res.record).toMatchObject({
      clientId: "c-whitaker",
      stage: "acquisition",
      previousStage: "capital_readiness",
      ruleVersion: "readiness.v1.0.0",
      reasonCodes: ["RC_ALL_ACQUISITION_GATES_MET"],
      proposedNextAction: REASON_CODE_NEXT_ACTIONS.RC_ALL_ACQUISITION_GATES_MET,
      requiresHumanReview: false,
      actorStaffId: "s-boyd",
    });
    // Persisted as the new latest record.
    expect(store.assessmentsFor(ORG, "c-whitaker").at(-1)?.id).toBe(res.record?.id);
    // Event carries the workflow facts.
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("ReadinessAssessed");
    expect(event.payload).toMatchObject({
      clientId: "c-whitaker",
      stage: "acquisition",
      previousStage: "capital_readiness",
      requiresHumanReview: false,
    });
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "readiness.assessed",
      targetId: "c-whitaker",
      reasonCode: "RC_ALL_ACQUISITION_GATES_MET",
    });
  });

  it("flags a stage regression for human review via the deterministic gate", () => {
    const seed = structuredClone(syntheticDatabase);
    // A prior recorded assessment claims Marcus Bell reached acquisition;
    // his current facts assess to recovery — the gate must flag the drop.
    seed.assessments.push({
      id: "ra-bell-prior",
      clientId: "c-bell",
      stage: "acquisition",
      previousStage: null,
      ruleVersion: "readiness.v1.0.0",
      reasonCodes: ["RC_ALL_ACQUISITION_GATES_MET"],
      factsUsed: [],
      proposedNextAction: "",
      requiresHumanReview: false,
      reviewReasonCodes: [],
      assessedAt: "2026-05-01T00:00:00.000Z",
      actorStaffId: "s-boyd",
    });
    const store = makeStore(seed);
    const res = store.runReadinessAssessment({
      organizationId: ORG,
      clientId: "c-bell",
      actorStaffId: "s-boyd",
    });
    expect(res.ok).toBe(true);
    expect(res.record).toMatchObject({
      stage: "recovery",
      previousStage: "acquisition",
      requiresHumanReview: true,
      reviewReasonCodes: ["RV_STAGE_REGRESSION"],
    });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.payload).toMatchObject({ requiresHumanReview: true });
  });
});

describe("runReadinessAssessment — eligibility and blockers", () => {
  it("denies assessment while the intake is not completed, audited", () => {
    const store = makeStore();
    const res = store.runReadinessAssessment({
      organizationId: ORG,
      clientId: "l-haddad",
      actorStaffId: "s-boyd",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INTAKE_NOT_COMPLETED" });
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "readiness.assessment_denied",
      reasonCode: "INTAKE_NOT_COMPLETED",
    });
  });

  it("blocks (never records) when verified profiles are missing", () => {
    const store = makeStore();
    // Complete Omar's intake — he still has no credit profile in the seed.
    for (const sectionId of ["primary_goal", "credit_self_report", "debts"]) {
      store.completeIntakeSection({ organizationId: ORG, clientId: "l-haddad", sectionId, actorStaffId: "s-boyd" });
    }
    store.completeIntake({ organizationId: ORG, clientId: "l-haddad", actorStaffId: "s-boyd" });
    const before = store.outbox.length;

    const res = store.runReadinessAssessment({
      organizationId: ORG,
      clientId: "l-haddad",
      actorStaffId: "s-boyd",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "MISSING_FACTS", missingFacts: ["credit_profile"] });
    expect(store.assessmentsFor(ORG, "l-haddad")).toHaveLength(0);
    expect(store.outbox).toHaveLength(before); // no event for a blocked attempt
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "readiness.assessment_blocked",
      reasonCode: "FACTS_MISSING",
    });
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.runReadinessAssessment({ organizationId: "org-other", clientId: "c-whitaker", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.runReadinessAssessment({ organizationId: ORG, clientId: "c-whitaker", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(store.outbox).toHaveLength(0);
  });
});

describe("seed integrity", () => {
  it("never mutates the module-level synthetic seed", () => {
    const seededCount = syntheticDatabase.assessments.length;
    const store = makeStore();
    store.runReadinessAssessment({ organizationId: ORG, clientId: "c-whitaker", actorStaffId: "s-boyd" });
    expect(syntheticDatabase.assessments).toHaveLength(seededCount);
  });
});
