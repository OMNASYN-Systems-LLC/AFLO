import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("createGoal", () => {
  it("creates a goal, emits GoalCreated, and audits", () => {
    const store = makeStore();
    const res = store.createGoal({
      organizationId: ORG,
      clientId: "c-grant",
      title: "  Pay off the auto loan  ",
      category: "debt",
      targetDate: "2027-01-15",
      isPrimary: false,
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.goal).toMatchObject({ title: "Pay off the auto loan", category: "debt", progressPct: 0, isPrimary: false });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("GoalCreated");
    expect(event.payload).toMatchObject({ clientId: "c-grant", category: "debt", isPrimary: false });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("goal.created");
  });

  it("enforces a single primary — a new primary demotes the old one", () => {
    const store = makeStore();
    // Alicia Grant has a seeded primary goal (g-grant-1).
    const before = store.goalsFor(ORG, "c-grant").filter((g) => g.isPrimary);
    expect(before).toHaveLength(1);
    store.createGoal({
      organizationId: ORG,
      clientId: "c-grant",
      title: "New primary focus",
      category: "savings",
      targetDate: "2027-03-01",
      isPrimary: true,
      actorStaffId: "s-mercer",
    });
    const primaries = store.goalsFor(ORG, "c-grant").filter((g) => g.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.title).toBe("New primary focus");
  });

  it("rejects invalid input", () => {
    const store = makeStore();
    const res = store.createGoal({
      organizationId: ORG,
      clientId: "c-grant",
      title: "   ",
      category: "moon_landing" as never,
      targetDate: "someday",
      isPrimary: false,
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(res.inputErrors).toHaveLength(3);
    expect(store.outbox).toHaveLength(0);
  });
});

describe("updateGoalProgress", () => {
  it("clamps to a valid range and audits", () => {
    const store = makeStore();
    const res = store.updateGoalProgress({
      organizationId: ORG,
      goalId: "g-grant-1",
      progressPct: 60,
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(store.goalsFor(ORG, "c-grant").find((g) => g.id === "g-grant-1")?.progressPct).toBe(60);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("goal.progress_updated");
  });

  it("rejects out-of-range progress", () => {
    const store = makeStore();
    expect(
      store.updateGoalProgress({ organizationId: ORG, goalId: "g-grant-1", progressPct: 150, actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(
      store.updateGoalProgress({ organizationId: ORG, goalId: "g-grant-1", progressPct: -5, actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
  });
});

describe("setPrimaryGoal", () => {
  it("makes one goal primary and demotes the rest", () => {
    const store = makeStore();
    // James Whitaker has two goals (g-whitaker-1 primary, g-whitaker-2 not).
    store.setPrimaryGoal({ organizationId: ORG, goalId: "g-whitaker-2", actorStaffId: "s-boyd" });
    const primaries = store.goalsFor(ORG, "c-whitaker").filter((g) => g.isPrimary);
    expect(primaries).toHaveLength(1);
    expect(primaries[0]?.id).toBe("g-whitaker-2");
  });
});

describe("goals tenant/actor isolation", () => {
  it("fails closed across boundaries", () => {
    const store = makeStore();
    expect(
      store.createGoal({ organizationId: "org-other", clientId: "c-grant", title: "x", category: "other", targetDate: "2027-01-01", isPrimary: false, actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.updateGoalProgress({ organizationId: ORG, goalId: "g-grant-1", progressPct: 10, actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(
      store.setPrimaryGoal({ organizationId: ORG, goalId: "g-does-not-exist", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "GOAL_NOT_FOUND" });
  });
});

describe("seed integrity", () => {
  it("never mutates the module-level seed", () => {
    const store = makeStore();
    store.updateGoalProgress({ organizationId: ORG, goalId: "g-grant-1", progressPct: 99, actorStaffId: "s-mercer" });
    expect(syntheticDatabase.goals.find((g) => g.id === "g-grant-1")?.progressPct).toBe(35);
  });
});
