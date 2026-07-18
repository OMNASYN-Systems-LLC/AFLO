import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

/** Omar Haddad's outstanding required sections in the seed. */
const OMAR_MISSING = ["primary_goal", "credit_self_report", "debts"];

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("intake auto-start on the pipeline backbone", () => {
  it("advancing a lead into intake_started opens its intake with linked events", () => {
    const store = makeStore();
    // Priya is at consultation_scheduled with no intake yet.
    expect(store.intakeFor(ORG, "l-natarajan")).toBeNull();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "l-natarajan",
      toStageId: "intake_started",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    const intake = store.intakeFor(ORG, "l-natarajan");
    expect(intake).toMatchObject({ status: "in_progress", completedSectionIds: [] });
    const [statusChanged, started] = store.outbox.map((r) => deserializeEvent(r.serializedEvent));
    expect(statusChanged!.eventType).toBe("LeadStatusChanged");
    expect(started!.eventType).toBe("IntakeStarted");
    expect(started!.causationId).toBe(statusChanged!.eventId);
    expect(started!.correlationId).toBe(statusChanged!.correlationId);
    expect(store.auditFor(ORG).map((a) => a.action)).toContain("intake.started");
  });

  it("never opens a duplicate intake on stage re-entry", () => {
    const store = makeStore();
    store.advanceLead({ organizationId: ORG, leadId: "l-natarajan", toStageId: "intake_started", actorStaffId: "s-mercer" });
    store.advanceLead({ organizationId: ORG, leadId: "l-natarajan", toStageId: "consultation_scheduled", actorStaffId: "s-mercer", reversal: true });
    store.advanceLead({ organizationId: ORG, leadId: "l-natarajan", toStageId: "intake_started", actorStaffId: "s-mercer" });
    expect(store.database().intakes.filter((i) => i.clientId === "l-natarajan")).toHaveLength(1);
  });
});

describe("completeIntakeSection", () => {
  it("marks a section complete with event, progress counts, and audit", () => {
    const store = makeStore();
    const res = store.completeIntakeSection({
      organizationId: ORG,
      clientId: "l-haddad",
      sectionId: "primary_goal",
      actorStaffId: "s-boyd",
    });
    expect(res.ok).toBe(true);
    expect(res.completeness?.completedRequiredCount).toBe(9);
    expect(res.completeness?.requiredCount).toBe(11);
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("IntakeSectionCompleted");
    expect(event.payload).toMatchObject({ sectionId: "primary_goal", completedRequiredCount: 9 });
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "intake.section_completed",
      targetId: "l-haddad",
      reasonCode: "IN_OK",
    });
  });

  it("denies unknown and already-complete sections, audited, without mutating", () => {
    const store = makeStore();
    const unknown = store.completeIntakeSection({
      organizationId: ORG,
      clientId: "l-haddad",
      sectionId: "ssn_capture",
      actorStaffId: "s-boyd",
    });
    expect(unknown).toMatchObject({ ok: false, ruleReasonCode: "IN_UNKNOWN_SECTION" });
    const dup = store.completeIntakeSection({
      organizationId: ORG,
      clientId: "l-haddad",
      sectionId: "identity",
      actorStaffId: "s-boyd",
    });
    expect(dup).toMatchObject({ ok: false, ruleReasonCode: "IN_SECTION_ALREADY_COMPLETE" });
    expect(store.outbox).toHaveLength(0);
    expect(store.intakeFor(ORG, "l-haddad")?.completedSectionIds).toHaveLength(9);
    expect(store.auditFor(ORG).filter((a) => a.action === "intake.section_denied")).toHaveLength(2);
  });

  it("requires an intake, a same-org record, and a same-org actor", () => {
    const store = makeStore();
    expect(
      store.completeIntakeSection({ organizationId: ORG, clientId: "l-cole", sectionId: "identity", actorStaffId: "s-lin" }),
    ).toMatchObject({ ok: false, denialCode: "INTAKE_NOT_STARTED" });
    expect(
      store.completeIntakeSection({ organizationId: "org-other", clientId: "l-haddad", sectionId: "debts", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.completeIntakeSection({ organizationId: ORG, clientId: "l-haddad", sectionId: "debts", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(store.outbox).toHaveLength(0);
  });
});

describe("completeIntake", () => {
  it("denies completion while required sections are missing — nothing mutates", () => {
    const store = makeStore();
    const res = store.completeIntake({ organizationId: ORG, clientId: "l-haddad", actorStaffId: "s-boyd" });
    expect(res).toMatchObject({ ok: false, ruleReasonCode: "IN_MISSING_REQUIRED" });
    expect(res.completeness?.missingRequiredSectionIds).toEqual(OMAR_MISSING);
    expect(store.intakeFor(ORG, "l-haddad")?.status).toBe("in_progress");
    expect(store.database().clients.find((c) => c.id === "l-haddad")?.pipelineStageId).toBe("intake_started");
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("intake.complete_denied");
  });

  it("completes the intake and advances the lead's stage in one linked operation", () => {
    const store = makeStore();
    for (const sectionId of OMAR_MISSING) {
      store.completeIntakeSection({ organizationId: ORG, clientId: "l-haddad", sectionId, actorStaffId: "s-boyd" });
    }
    const res = store.completeIntake({ organizationId: ORG, clientId: "l-haddad", actorStaffId: "s-boyd" });
    expect(res.ok).toBe(true);
    expect(store.intakeFor(ORG, "l-haddad")).toMatchObject({
      status: "completed",
      completedAt: NOW.toISOString(),
    });
    expect(store.database().clients.find((c) => c.id === "l-haddad")?.pipelineStageId).toBe("intake_completed");
    const [completed, statusChanged] = store.outbox.slice(-2).map((r) => deserializeEvent(r.serializedEvent));
    expect(completed!.eventType).toBe("IntakeCompleted");
    expect(statusChanged!.eventType).toBe("LeadStatusChanged");
    expect(statusChanged!.causationId).toBe(completed!.eventId);
    expect(statusChanged!.correlationId).toBe(completed!.correlationId);
    const actions = store.auditFor(ORG).map((a) => a.action);
    expect(actions).toContain("intake.completed");
    expect(actions).toContain("lead.stage_advanced");
  });

  it("refuses a second completion", () => {
    const store = makeStore();
    for (const sectionId of OMAR_MISSING) {
      store.completeIntakeSection({ organizationId: ORG, clientId: "l-haddad", sectionId, actorStaffId: "s-boyd" });
    }
    store.completeIntake({ organizationId: ORG, clientId: "l-haddad", actorStaffId: "s-boyd" });
    expect(
      store.completeIntake({ organizationId: ORG, clientId: "l-haddad", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "INTAKE_ALREADY_COMPLETED" });
  });
});

describe("pipeline gate on intake_completed", () => {
  it("denies advancing a lead into intake_completed while the intake is incomplete", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "l-haddad",
      toStageId: "intake_completed",
      actorStaffId: "s-boyd",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INTAKE_INCOMPLETE" });
    expect(store.database().clients.find((c) => c.id === "l-haddad")?.pipelineStageId).toBe("intake_started");
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "lead.stage_denied",
      reasonCode: "IN_MISSING_REQUIRED",
    });
  });

  it("allows re-entering intake_completed after a reversal once the intake is complete", () => {
    const store = makeStore();
    for (const sectionId of OMAR_MISSING) {
      store.completeIntakeSection({ organizationId: ORG, clientId: "l-haddad", sectionId, actorStaffId: "s-boyd" });
    }
    store.completeIntake({ organizationId: ORG, clientId: "l-haddad", actorStaffId: "s-boyd" });
    store.advanceLead({ organizationId: ORG, leadId: "l-haddad", toStageId: "intake_started", actorStaffId: "s-boyd", reversal: true });
    const forward = store.advanceLead({
      organizationId: ORG,
      leadId: "l-haddad",
      toStageId: "intake_completed",
      actorStaffId: "s-boyd",
    });
    expect(forward.ok).toBe(true);
  });
});

describe("seed integrity", () => {
  it("gives every activated client a completed historical intake", () => {
    const store = makeStore();
    for (const c of store.database().clients.filter((c) => c.kind === "client")) {
      expect(store.intakeFor(ORG, c.id)?.status).toBe("completed");
    }
  });

  it("never mutates the module-level synthetic seed", () => {
    const store = makeStore();
    store.completeIntakeSection({ organizationId: ORG, clientId: "l-haddad", sectionId: "debts", actorStaffId: "s-boyd" });
    const seedIntake = syntheticDatabase.intakes.find((i) => i.clientId === "l-haddad");
    expect(seedIntake?.completedSectionIds).toHaveLength(9);
  });
});
