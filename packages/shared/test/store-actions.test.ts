import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("addMonthlyAction", () => {
  it("creates a todo action in the month it is due, with TaskAssigned + audit", () => {
    const store = makeStore();
    const res = store.addMonthlyAction({
      organizationId: ORG,
      clientId: "c-grant",
      title: "  Confirm autopay on the car loan  ",
      category: "payment",
      dueDate: "2026-07-30",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.action).toMatchObject({
      clientId: "c-grant",
      title: "Confirm autopay on the car loan", // trimmed
      month: "2026-07",
      status: "todo",
      category: "payment",
    });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("TaskAssigned");
    expect(event.payload).toMatchObject({ clientId: "c-grant", milestoneId: null, templateId: null });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("action.assigned");
    expect(store.database().monthlyActions.some((a) => a.id === res.action?.id)).toBe(true);
  });

  it("denies and audits invalid input without mutating", () => {
    const store = makeStore();
    const res = store.addMonthlyAction({
      organizationId: ORG,
      clientId: "c-grant",
      title: "   ",
      category: "gambling" as never,
      dueDate: "not-a-date",
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(res.inputErrors).toHaveLength(3);
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "action.create_denied",
      reasonCode: "AC_INVALID_INPUT",
    });
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.addMonthlyAction({ organizationId: "org-other", clientId: "c-grant", title: "x", category: "habit", dueDate: "2026-07-30", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.addMonthlyAction({ organizationId: ORG, clientId: "c-grant", title: "x", category: "habit", dueDate: "2026-07-30", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
  });
});

describe("transitionMonthlyAction", () => {
  it("completes an in-progress action with TaskCompleted and activity update", () => {
    const store = makeStore();
    const res = store.transitionMonthlyAction({
      organizationId: ORG,
      actionId: "ma-grant-2",
      toStatus: "done",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.transition?.reasonCode).toBe("AC_COMPLETED");
    expect(store.database().monthlyActions.find((a) => a.id === "ma-grant-2")?.status).toBe("done");
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("TaskCompleted");
    expect(event.payload).toMatchObject({
      taskId: "ma-grant-2",
      completedBy: "staff",
      verifiedByMemberId: "s-mercer",
    });
    expect(store.database().clients.find((c) => c.id === "c-grant")?.lastActivityAt).toBe(NOW.toISOString());
    expect(store.auditFor(ORG).at(-1)?.action).toBe("action.completed");
  });

  it("flags reopening a done action and emits no completion event", () => {
    const store = makeStore();
    const res = store.transitionMonthlyAction({
      organizationId: ORG,
      actionId: "ma-grant-1", // seeded done
      toStatus: "todo",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.transition?.reasonCode).toBe("AC_REOPENED");
    expect(store.outbox).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("action.reopened");
  });

  it("denies same-status moves, audited, never mutating", () => {
    const store = makeStore();
    const res = store.transitionMonthlyAction({
      organizationId: ORG,
      actionId: "ma-grant-2",
      toStatus: "in_progress",
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false });
    expect(res.transition?.reasonCode).toBe("AC_SAME_STATUS");
    expect(store.database().monthlyActions.find((a) => a.id === "ma-grant-2")?.status).toBe("in_progress");
    expect(store.auditFor(ORG).at(-1)?.action).toBe("action.transition_denied");
  });

  it("enforces tenant and actor isolation", () => {
    const store = makeStore();
    expect(
      store.transitionMonthlyAction({ organizationId: "org-other", actionId: "ma-grant-2", toStatus: "done", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "ACTION_NOT_FOUND" });
    expect(
      store.transitionMonthlyAction({ organizationId: ORG, actionId: "ma-grant-2", toStatus: "done", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(store.database().monthlyActions.find((a) => a.id === "ma-grant-2")?.status).toBe("in_progress");
  });
});

describe("seed integrity", () => {
  it("never mutates the module-level synthetic seed", () => {
    const store = makeStore();
    store.transitionMonthlyAction({ organizationId: ORG, actionId: "ma-grant-2", toStatus: "done", actorStaffId: "s-mercer" });
    expect(syntheticDatabase.monthlyActions.find((a) => a.id === "ma-grant-2")?.status).toBe("in_progress");
  });
});
