import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

function pryor(store: AfloStore) {
  return store.database().roadmaps.find((r) => r.id === "r-c-pryor")!;
}

function outboxEvents(store: AfloStore) {
  return store.outbox.map((r) => deserializeEvent(r.serializedEvent));
}

describe("transitionRoadmap — approval path", () => {
  it("walks draft → staff_review → approved → published with events and audit", () => {
    const store = makeStore();
    const submit = store.transitionRoadmap({
      organizationId: ORG,
      roadmapId: "r-c-pryor",
      toStatus: "staff_review",
      actorStaffId: "s-boyd",
    });
    expect(submit.ok).toBe(true);
    expect(submit.transition?.reasonCode).toBe("RM_SUBMITTED");
    // Submission emits no DOMAIN event; the bridged review shadow entering
    // the queue in the same mutation is the only outbox record (ADR-0049).
    expect(outboxEvents(store).map((e) => e.eventType)).toEqual(["ReviewItemSubmitted"]);

    const approve = store.transitionRoadmap({
      organizationId: ORG,
      roadmapId: "r-c-pryor",
      toStatus: "approved",
      actorStaffId: "s-mercer",
    });
    expect(approve.ok).toBe(true);
    expect(pryor(store)).toMatchObject({
      status: "approved",
      approvedByStaffId: "s-mercer",
      approvedAt: NOW.toISOString(),
    });
    const approvedEvent = outboxEvents(store).find((e) => e.eventType === "RoadmapApproved")!;
    expect(approvedEvent.payload).toMatchObject({
      clientId: "c-pryor",
      approvedByMemberId: "s-mercer",
      publishedToClient: false,
    });

    const publish = store.transitionRoadmap({
      organizationId: ORG,
      roadmapId: "r-c-pryor",
      toStatus: "published",
      actorStaffId: "s-mercer",
    });
    expect(publish.ok).toBe(true);
    expect(pryor(store).publishedAt).toBe(NOW.toISOString());
    expect(outboxEvents(store).some((e) => e.eventType === "RoadmapPublished")).toBe(true);

    const actions = store.auditFor(ORG).map((a) => a.action);
    expect(actions).toEqual(
      expect.arrayContaining(["roadmap.submitted", "roadmap.approved", "roadmap.published"]),
    );
  });

  it("reopening an approved roadmap withdraws the approval", () => {
    const store = makeStore();
    store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "staff_review", actorStaffId: "s-boyd" });
    store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "approved", actorStaffId: "s-mercer" });
    const reopen = store.transitionRoadmap({
      organizationId: ORG,
      roadmapId: "r-c-pryor",
      toStatus: "draft",
      actorStaffId: "s-boyd",
    });
    expect(reopen.ok).toBe(true);
    expect(reopen.transition?.reasonCode).toBe("RM_REOPENED");
    expect(pryor(store)).toMatchObject({ status: "draft", approvedByStaffId: null, approvedAt: null });
  });
});

describe("transitionRoadmap — denials never mutate", () => {
  it("denies skipping straight to published, audited", () => {
    const store = makeStore();
    const res = store.transitionRoadmap({
      organizationId: ORG,
      roadmapId: "r-c-pryor",
      toStatus: "published",
      actorStaffId: "s-boyd",
    });
    expect(res).toMatchObject({ ok: false });
    expect(res.transition?.reasonCode).toBe("RM_ILLEGAL_TRANSITION");
    expect(pryor(store).status).toBe("draft");
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("roadmap.transition_denied");
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.transitionRoadmap({ organizationId: "org-other", roadmapId: "r-c-pryor", toStatus: "staff_review", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "ROADMAP_NOT_FOUND" });
    expect(
      store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "staff_review", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(pryor(store).status).toBe("draft");
  });
});

describe("seed integrity", () => {
  it("links every milestone to its client's roadmap", () => {
    for (const ms of syntheticDatabase.milestones) {
      const roadmap = syntheticDatabase.roadmaps.find((r) => r.id === ms.roadmapId);
      expect(roadmap?.clientId).toBe(ms.clientId);
    }
  });

  it("never mutates the module-level synthetic seed", () => {
    const store = makeStore();
    store.transitionRoadmap({ organizationId: ORG, roadmapId: "r-c-pryor", toStatus: "staff_review", actorStaffId: "s-boyd" });
    expect(syntheticDatabase.roadmaps.find((r) => r.id === "r-c-pryor")?.status).toBe("draft");
  });
});
