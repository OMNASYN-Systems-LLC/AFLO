import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z"); // → 2026-Q3

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("generateQuarterlyReport", () => {
  it("drafts the quarter's report deterministically from recorded facts", () => {
    const store = makeStore();
    // Whitaker's latest recorded assessment is capital_readiness (seeded history).
    const res = store.generateQuarterlyReport({
      organizationId: ORG,
      clientId: "c-whitaker",
      actorStaffId: "s-boyd",
    });
    expect(res.ok).toBe(true);
    expect(res.report).toMatchObject({
      clientId: "c-whitaker",
      quarter: "2026-Q3",
      status: "draft",
      stageAtGeneration: "capital_readiness",
      focusForNextQuarter: "Target reporting-date balances to bring utilization under 10%",
    });
    expect(res.report?.highlights).toEqual([
      "Readiness stage: Capital Readiness (rule readiness.v1.0.0)",
      "Stage moved from Credit Readiness to Capital Readiness this period",
      "Action plan: 1 of 2 actions completed this quarter",
      "Verified documents on file: 2",
      'Roadmap "Acquisition: first home purchase": 2 of 4 milestones complete',
    ]);
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("ProgressReportGenerated");
    expect(event.payload).toMatchObject({ quarter: "2026-Q3", reviewStatus: "pending_review", aiRunId: null });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("report.generated");
  });

  it("refuses a second report for the same quarter, audited", () => {
    const store = makeStore();
    store.generateQuarterlyReport({ organizationId: ORG, clientId: "c-whitaker", actorStaffId: "s-boyd" });
    const res = store.generateQuarterlyReport({ organizationId: ORG, clientId: "c-whitaker", actorStaffId: "s-boyd" });
    expect(res).toMatchObject({ ok: false, denialCode: "REPORT_EXISTS_FOR_QUARTER" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("report.generate_denied");
  });

  it("requires a recorded assessment — reports never draw on unrecorded state", () => {
    const store = makeStore();
    const res = store.generateQuarterlyReport({
      organizationId: ORG,
      clientId: "c-grant",
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "NO_RECORDED_ASSESSMENT" });
    expect(store.database().reports.filter((r) => r.clientId === "c-grant" && r.quarter === "2026-Q3")).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "report.generate_denied",
      reasonCode: "NO_RECORDED_ASSESSMENT",
    });
  });

  it("denies leads and enforces tenant/actor isolation", () => {
    const store = makeStore();
    expect(
      store.generateQuarterlyReport({ organizationId: ORG, clientId: "l-natarajan", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "NOT_A_CLIENT" });
    expect(
      store.generateQuarterlyReport({ organizationId: "org-other", clientId: "c-whitaker", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.generateQuarterlyReport({ organizationId: ORG, clientId: "c-whitaker", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });
});

describe("transitionReport", () => {
  it("publishes a ready-for-review report with event and audit", () => {
    const store = makeStore();
    // Renee Solomon's Q2 report is seeded ready_for_review.
    const res = store.transitionReport({
      organizationId: ORG,
      reportId: "qr-solomon-q2",
      toStatus: "published",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(store.database().reports.find((r) => r.id === "qr-solomon-q2")?.status).toBe("published");
    const events = store.outbox.map((r) => deserializeEvent(r.serializedEvent));
    const event = events.find((e) => e.eventType === "ProgressReportPublished")!;
    expect(event.payload).toMatchObject({ reportId: "qr-solomon-q2", publishedByMemberId: "s-mercer" });
    // ADR-0049: the bridged shadow was carried awaiting_review → approved →
    // published in the SAME mutation (report.v1.0.0 has no approved state).
    expect(events.map((e) => e.eventType)).toEqual([
      "ProgressReportPublished",
      "ReviewDecisionRecorded",
      "ReviewItemPublished",
    ]);
    expect(store.auditFor(ORG).map((a) => a.action)).toContain("report.published");
  });

  it("denies publishing a draft directly — review is never skipped", () => {
    const store = makeStore();
    // Tanya Okafor's Q2 report is seeded draft.
    const res = store.transitionReport({
      organizationId: ORG,
      reportId: "qr-okafor-q2",
      toStatus: "published",
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false });
    expect(res.transition?.reasonCode).toBe("RP_ILLEGAL_TRANSITION");
    expect(store.database().reports.find((r) => r.id === "qr-okafor-q2")?.status).toBe("draft");
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("report.transition_denied");
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.transitionReport({ organizationId: "org-other", reportId: "qr-solomon-q2", toStatus: "published", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "REPORT_NOT_FOUND" });
    expect(
      store.transitionReport({ organizationId: ORG, reportId: "qr-solomon-q2", toStatus: "published", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });
});

describe("seed integrity", () => {
  it("never mutates the module-level synthetic seed", () => {
    const store = makeStore();
    store.generateQuarterlyReport({ organizationId: ORG, clientId: "c-whitaker", actorStaffId: "s-boyd" });
    store.transitionReport({ organizationId: ORG, reportId: "qr-solomon-q2", toStatus: "published", actorStaffId: "s-mercer" });
    expect(syntheticDatabase.reports.some((r) => r.quarter === "2026-Q3")).toBe(false);
    expect(syntheticDatabase.reports.find((r) => r.id === "qr-solomon-q2")?.status).toBe("ready_for_review");
  });
});
