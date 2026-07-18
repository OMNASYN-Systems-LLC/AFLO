import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("assignEducation", () => {
  it("assigns a lesson from a trigger with full provenance and an event", () => {
    const store = makeStore();
    const res = store.assignEducation({
      organizationId: ORG,
      clientId: "c-grant",
      trigger: "missing_document",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.assignment).toMatchObject({
      lessonId: "lsn-documents",
      trigger: "missing_document",
      reasonCode: "EDU_DOCUMENT",
      ruleVersion: "education.v1.0.0",
      contentVersion: "1.0.0",
      completedAt: null,
    });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("EducationAssigned");
    expect(event.payload).toMatchObject({ trigger: "missing_document", moduleId: "lsn-documents" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("education.assigned");
  });

  it("is idempotent while an assignment is still open (no duplicate stacking)", () => {
    const store = makeStore();
    const first = store.assignEducation({ organizationId: ORG, clientId: "c-grant", trigger: "missing_document", actorStaffId: "s-mercer" });
    const before = store.educationFor(ORG, "c-grant").length;
    const second = store.assignEducation({ organizationId: ORG, clientId: "c-grant", trigger: "missing_document", actorStaffId: "s-mercer" });
    expect(second.assignment?.id).toBe(first.assignment?.id);
    expect(second.emittedEventIds).toEqual([]);
    expect(store.educationFor(ORG, "c-grant").length).toBe(before);
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.assignEducation({ organizationId: "org-other", clientId: "c-grant", trigger: "missed_action", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.assignEducation({ organizationId: ORG, clientId: "c-grant", trigger: "missed_action", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });
});

describe("completeEducation", () => {
  it("completes an open assignment and scores the knowledge check", () => {
    const store = makeStore();
    // Renee Solomon's seeded assignment (lsn-utilization has a check: 4 Qs, 0.75).
    const res = store.completeEducation({
      organizationId: ORG,
      assignmentId: "edu-solomon-1",
      correct: 3,
      total: 4,
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.assignment).toMatchObject({ completedAt: NOW.toISOString(), knowledgeCheckScore: 0.75 });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("EducationCompleted");
    expect(event.payload).toMatchObject({ assignmentId: "edu-solomon-1", knowledgeCheckScore: 0.75 });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("education.completed");
  });

  it("refuses to complete an already-completed assignment", () => {
    const store = makeStore();
    // James Whitaker's seeded assignment is already completed.
    expect(
      store.completeEducation({ organizationId: ORG, assignmentId: "edu-whitaker-1", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "ALREADY_COMPLETED" });
  });

  it("records no score when the lesson has no knowledge check", () => {
    const store = makeStore();
    const assigned = store.assignEducation({ organizationId: ORG, clientId: "c-grant", trigger: "missing_document", actorStaffId: "s-mercer" });
    const res = store.completeEducation({ organizationId: ORG, assignmentId: assigned.assignment!.id, actorStaffId: "s-mercer" });
    expect(res.assignment).toMatchObject({ knowledgeCheckScore: null });
  });
});

describe("seed integrity", () => {
  it("never mutates the module-level seed", () => {
    const store = makeStore();
    store.completeEducation({ organizationId: ORG, assignmentId: "edu-solomon-1", correct: 4, total: 4, actorStaffId: "s-mercer" });
    expect(syntheticDatabase.educationAssignments.find((e) => e.id === "edu-solomon-1")?.completedAt).toBeNull();
  });
});
