import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("requestDocument", () => {
  it("creates a requested document with event and audit", () => {
    const store = makeStore();
    const res = store.requestDocument({
      organizationId: ORG,
      clientId: "c-okafor",
      name: "2026 personal tax return",
      docType: "income_verification",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.document).toMatchObject({ reviewStatus: "requested", clientId: "c-okafor" });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("DocumentRequested");
    expect(store.auditFor(ORG).map((a) => a.action)).toContain("doc.requested");
  });

  it("denies invalid input, audited", () => {
    const store = makeStore();
    const res = store.requestDocument({
      organizationId: ORG,
      clientId: "c-okafor",
      name: "  ",
      docType: "diary" as never,
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(res.inputErrors).toHaveLength(2);
    expect(store.outbox).toHaveLength(0);
  });
});

describe("transitionDocument", () => {
  it("walks upload → review → approved with the right events", () => {
    const store = makeStore();
    // d-okafor-3 is seeded "uploaded".
    const start = store.transitionDocument({
      organizationId: ORG,
      documentId: "d-okafor-3",
      toStatus: "in_review",
      actorStaffId: "s-mercer",
    });
    expect(start.ok).toBe(true);
    expect(store.outbox).toHaveLength(0); // starting review is audit-only

    const approve = store.transitionDocument({
      organizationId: ORG,
      documentId: "d-okafor-3",
      toStatus: "approved",
      actorStaffId: "s-mercer",
    });
    expect(approve.ok).toBe(true);
    const reviewed = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(reviewed.eventType).toBe("DocumentReviewed");
    expect(reviewed.payload).toMatchObject({
      documentId: "d-okafor-3",
      reviewStatus: "approved",
      reviewedByMemberId: "s-mercer",
    });
    expect(store.auditFor(ORG).map((a) => a.action)).toEqual(
      expect.arrayContaining(["doc.review_started", "doc.approved"]),
    );
  });

  it("emits DocumentUploaded with a synthetic storage ref on receipt", () => {
    const store = makeStore();
    // d-grant-2 is seeded "requested".
    const res = store.transitionDocument({
      organizationId: ORG,
      documentId: "d-grant-2",
      toStatus: "uploaded",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("DocumentUploaded");
    expect(event.payload).toMatchObject({ storageRef: "synthetic://d-grant-2" });
  });

  it("denies moving an approved document, audited, never mutating", () => {
    const store = makeStore();
    // d-okafor-1 is seeded "approved" — terminal.
    const res = store.transitionDocument({
      organizationId: ORG,
      documentId: "d-okafor-1",
      toStatus: "in_review",
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false });
    expect(res.transition?.reasonCode).toBe("DOC_ILLEGAL_TRANSITION");
    expect(store.database().documents.find((d) => d.id === "d-okafor-1")?.reviewStatus).toBe("approved");
    expect(store.auditFor(ORG).at(-1)?.action).toBe("doc.transition_denied");
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.transitionDocument({ organizationId: "org-other", documentId: "d-okafor-3", toStatus: "in_review", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "DOCUMENT_NOT_FOUND" });
    expect(
      store.transitionDocument({ organizationId: ORG, documentId: "d-okafor-3", toStatus: "in_review", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });
});

describe("scheduleAppointment", () => {
  it("schedules a future appointment with the acting staff member", () => {
    const store = makeStore();
    const res = store.scheduleAppointment({
      organizationId: ORG,
      clientId: "c-okafor",
      purpose: "Capital application review",
      scheduledAt: "2026-07-20T15:00:00.000Z",
      channel: "video",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.appointment).toMatchObject({ staffId: "s-mercer", channel: "video" });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("AppointmentScheduled");
    expect(store.auditFor(ORG).map((a) => a.action)).toContain("appointment.scheduled");
  });

  it("denies past times and bad input, audited", () => {
    const store = makeStore();
    const res = store.scheduleAppointment({
      organizationId: ORG,
      clientId: "c-okafor",
      purpose: "",
      scheduledAt: "2026-07-01T10:00:00.000Z", // before NOW
      channel: "carrier_pigeon" as never,
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(res.inputErrors).toHaveLength(3);
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("appointment.schedule_denied");
  });
});

describe("addNote", () => {
  it("appends an internal note with audit", () => {
    const store = makeStore();
    const res = store.addNote({
      organizationId: ORG,
      clientId: "c-okafor",
      body: "Confirmed lender checklist received.",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(store.database().notes.at(-1)).toMatchObject({
      clientId: "c-okafor",
      staffId: "s-mercer",
      body: "Confirmed lender checklist received.",
    });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("note.added");
  });

  it("rejects empty notes and foreign actors", () => {
    const store = makeStore();
    expect(
      store.addNote({ organizationId: ORG, clientId: "c-okafor", body: "   ", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(
      store.addNote({ organizationId: ORG, clientId: "c-okafor", body: "x", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });
});

describe("seed integrity", () => {
  it("never mutates the module-level synthetic seed", () => {
    const store = makeStore();
    store.transitionDocument({ organizationId: ORG, documentId: "d-okafor-3", toStatus: "in_review", actorStaffId: "s-mercer" });
    store.addNote({ organizationId: ORG, clientId: "c-okafor", body: "x", actorStaffId: "s-mercer" });
    expect(syntheticDatabase.documents.find((d) => d.id === "d-okafor-3")?.reviewStatus).toBe("uploaded");
    expect(syntheticDatabase.notes.some((n) => n.body === "x")).toBe(false);
  });
});
