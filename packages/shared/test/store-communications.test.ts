import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("notification wiring — consented clients", () => {
  it("records a sent communication when a document is requested", () => {
    const store = makeStore();
    store.requestDocument({
      organizationId: ORG,
      clientId: "c-okafor",
      name: "2026 tax return",
      docType: "income_verification",
      actorStaffId: "s-mercer",
    });
    const comms = store.communicationsFor(ORG, "c-okafor");
    expect(comms).toHaveLength(1);
    expect(comms[0]).toMatchObject({
      notificationType: "document_requested",
      status: "sent",
      suppressionReason: null,
    });
    expect(comms[0]?.subject).toContain("document");
    expect(store.auditFor(ORG).at(-1)?.action).toBe("comm.sent");
  });

  it("records a sent communication when an appointment is scheduled", () => {
    const store = makeStore();
    store.scheduleAppointment({
      organizationId: ORG,
      clientId: "c-okafor",
      purpose: "Capital review",
      scheduledAt: "2026-07-25T15:00:00.000Z",
      channel: "video",
      actorStaffId: "s-mercer",
    });
    expect(store.communicationsFor(ORG, "c-okafor").at(-1)).toMatchObject({
      notificationType: "appointment_scheduled",
      status: "sent",
    });
  });

  it("records a sent communication when a report is published", () => {
    const store = makeStore();
    store.transitionReport({
      organizationId: ORG,
      reportId: "qr-solomon-q2",
      toStatus: "published",
      actorStaffId: "s-mercer",
    });
    expect(store.communicationsFor(ORG, "c-solomon").at(-1)).toMatchObject({
      notificationType: "report_published",
      status: "sent",
    });
  });

  it("records a sent communication when a roadmap is published", () => {
    const store = makeStore();
    // Devon Pryor's roadmap is a draft; walk it to published.
    store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "staff_review", actorStaffId: "s-boyd" });
    store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "approved", actorStaffId: "s-mercer" });
    store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "published", actorStaffId: "s-mercer" });
    expect(store.communicationsFor(ORG, "c-pryor").at(-1)).toMatchObject({
      notificationType: "roadmap_published",
      status: "sent",
    });
  });
});

describe("notification wiring — the consent gate", () => {
  it("suppresses communications for a client who revoked consent", () => {
    const store = makeStore();
    // Harold Ngo granted then revoked communication consent in the seed.
    store.requestDocument({
      organizationId: ORG,
      clientId: "c-ngo",
      name: "Updated statement",
      docType: "bank_statement",
      actorStaffId: "s-boyd",
    });
    const comm = store.communicationsFor(ORG, "c-ngo").at(-1);
    expect(comm).toMatchObject({
      notificationType: "document_requested",
      status: "suppressed",
      suppressionReason: "NO_COMMUNICATION_CONSENT",
      subject: null, // no content is rendered for a suppressed message
    });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("comm.suppressed");
  });
});

describe("communicationsFor isolation", () => {
  it("returns nothing across a tenant boundary", () => {
    const store = makeStore();
    store.requestDocument({
      organizationId: ORG,
      clientId: "c-okafor",
      name: "Doc",
      docType: "other",
      actorStaffId: "s-mercer",
    });
    expect(store.communicationsFor("org-other", "c-okafor")).toEqual([]);
  });
});
