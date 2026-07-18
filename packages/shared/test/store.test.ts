import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("AfloStore.advanceLead — legal path", () => {
  it("advances a lead one required stage, emitting event + audit", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "l-cole",
      toStageId: "consultation_scheduled",
      actorStaffId: "s-lin",
    });
    expect(res.ok).toBe(true);
    expect(res.activated).toBe(false);
    expect(res.record?.pipelineStageId).toBe("consultation_scheduled");
    // Event landed in the outbox with the full envelope.
    expect(store.outbox).toHaveLength(1);
    const event = deserializeEvent(store.outbox[0]!.serializedEvent);
    expect(event.eventType).toBe("LeadStatusChanged");
    expect(event.organizationId).toBe(ORG);
    expect(event.actorId).toBe("s-lin");
    // Audit entry recorded.
    const audit = store.auditFor(ORG);
    expect(audit.at(-1)).toMatchObject({
      action: "lead.stage_advanced",
      targetId: "l-cole",
      reasonCode: "PL_OK",
    });
    // Mutation is visible to readers of the live database view.
    expect(store.database().clients.find((c) => c.id === "l-cole")?.pipelineStageId).toBe(
      "consultation_scheduled",
    );
  });

  it("activation converts the lead to a client and emits a caused ClientActivated", () => {
    const store = makeStore();
    // Omar is at intake_started; walk the required path to activation.
    for (const to of ["intake_completed", "client_activated"]) {
      const res = store.advanceLead({
        organizationId: ORG,
        leadId: "l-haddad",
        toStageId: to,
        actorStaffId: "s-boyd",
      });
      expect(res.ok).toBe(true);
    }
    const record = store.database().clients.find((c) => c.id === "l-haddad")!;
    expect(record.kind).toBe("client");
    expect(record.clientStatus).toBe("active");
    // Last two outbox events: LeadStatusChanged then ClientActivated, causally linked.
    const [statusChanged, activatedEvent] = store.outbox.slice(-2).map((r) => deserializeEvent(r.serializedEvent));
    expect(statusChanged!.eventType).toBe("LeadStatusChanged");
    expect(activatedEvent!.eventType).toBe("ClientActivated");
    expect(activatedEvent!.causationId).toBe(statusChanged!.eventId);
    expect(activatedEvent!.correlationId).toBe(statusChanged!.correlationId);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("lead.activated");
  });
});

describe("AfloStore.advanceLead — denials never mutate", () => {
  it("denies skipping required stages and audits the attempt", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "l-cole",
      toStageId: "client_activated",
      actorStaffId: "s-lin",
    });
    expect(res.ok).toBe(false);
    expect(res.transition?.reasonCode).toBe("PL_REQUIRED_STAGE_SKIPPED");
    expect(store.database().clients.find((c) => c.id === "l-cole")?.pipelineStageId).toBe("new_lead");
    expect(store.outbox).toHaveLength(0); // no event for a denied move
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "lead.stage_denied",
      reasonCode: "PL_REQUIRED_STAGE_SKIPPED",
    });
  });

  it("flags reversals distinctly in the audit trail", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "l-natarajan",
      toStageId: "new_lead",
      actorStaffId: "s-mercer",
      reversal: true,
    });
    expect(res.ok).toBe(true);
    expect(res.transition?.reasonCode).toBe("PL_REVERSED");
    expect(store.auditFor(ORG).at(-1)?.action).toBe("lead.stage_reversed");
  });

  it("refuses to move an activated client through the lead pipeline", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "c-whitaker",
      toStageId: "new_lead",
      actorStaffId: "s-boyd",
      reversal: true,
    });
    expect(res).toMatchObject({ ok: false, denialCode: "NOT_A_LEAD" });
  });
});

describe("AfloStore.advanceLead — tenant and actor isolation", () => {
  it("cannot touch a lead through the wrong organization", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: "org-other",
      leadId: "l-cole",
      toStageId: "consultation_scheduled",
      actorStaffId: "s-lin",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "LEAD_NOT_FOUND" });
    expect(store.database().clients.find((c) => c.id === "l-cole")?.pipelineStageId).toBe("new_lead");
  });

  it("rejects an actor who is not staff of the organization", () => {
    const store = makeStore();
    const res = store.advanceLead({
      organizationId: ORG,
      leadId: "l-cole",
      toStageId: "consultation_scheduled",
      actorStaffId: "s-intruder",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(store.outbox).toHaveLength(0);
  });
});

describe("AfloStore seed isolation", () => {
  it("never mutates the module-level synthetic seed", () => {
    const store = makeStore();
    store.advanceLead({
      organizationId: ORG,
      leadId: "l-cole",
      toStageId: "consultation_scheduled",
      actorStaffId: "s-lin",
    });
    expect(syntheticDatabase.clients.find((c) => c.id === "l-cole")?.pipelineStageId).toBe("new_lead");
  });
});
