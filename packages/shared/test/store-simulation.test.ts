import { describe, expect, it } from "vitest";
import { roundUpAmountCents } from "@aflo/rules";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("configureSimulation", () => {
  it("creates settings on first use and updates them thereafter", () => {
    const store = makeStore();
    // Marcus Bell has no simulation settings seeded.
    expect(store.simulationFor(ORG, "c-bell")).toBeNull();
    const created = store.configureSimulation({
      organizationId: ORG,
      clientId: "c-bell",
      roundToCents: 100,
      multiplier: 2,
      enabled: true,
      actorStaffId: "s-boyd",
    });
    expect(created.ok).toBe(true);
    expect(store.simulationFor(ORG, "c-bell")).toMatchObject({ roundToCents: 100, multiplier: 2, enabled: true });

    store.configureSimulation({
      organizationId: ORG,
      clientId: "c-bell",
      roundToCents: 500,
      multiplier: 1,
      enabled: false,
      actorStaffId: "s-boyd",
    });
    expect(store.simulationFor(ORG, "c-bell")).toMatchObject({ roundToCents: 500, multiplier: 1, enabled: false });
    expect(store.auditFor(ORG).filter((a) => a.action === "simulation.configured")).toHaveLength(2);
  });

  it("rejects invalid settings", () => {
    const store = makeStore();
    expect(
      store.configureSimulation({ organizationId: ORG, clientId: "c-bell", roundToCents: 0, multiplier: 1, enabled: true, actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(
      store.configureSimulation({ organizationId: ORG, clientId: "c-bell", roundToCents: 100, multiplier: -1, enabled: true, actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
  });
});

describe("addVirtualTransaction", () => {
  it("computes the round-up via the rule so the stored value matches", () => {
    const store = makeStore();
    // Alicia Grant: round to $1, multiplier 1 (seeded).
    const res = store.addVirtualTransaction({
      organizationId: ORG,
      clientId: "c-grant",
      label: "Bookstore",
      amountCents: 1723,
      occurredOn: "2026-07-15",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.transaction?.roundUpAmountCents).toBe(roundUpAmountCents(1723, 100, 1)); // 77
    expect(store.virtualTransactionsFor(ORG, "c-grant").map((t) => t.id)).toContain(res.transaction?.id);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("simulation.transaction_added");
  });

  it("applies the client's configured multiplier", () => {
    const store = makeStore();
    // Sofia Ramirez: multiplier 2 (seeded).
    const res = store.addVirtualTransaction({
      organizationId: ORG,
      clientId: "c-ramirez",
      label: "Movie",
      amountCents: 1450,
      occurredOn: "2026-07-16",
      actorStaffId: "s-lin",
    });
    expect(res.transaction?.roundUpAmountCents).toBe(roundUpAmountCents(1450, 100, 2)); // 50 × 2 = 100
  });

  it("rejects invalid input", () => {
    const store = makeStore();
    const res = store.addVirtualTransaction({
      organizationId: ORG,
      clientId: "c-grant",
      label: "  ",
      amountCents: -5,
      occurredOn: "nope",
      actorStaffId: "s-mercer",
    });
    expect(res).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(res.inputErrors).toHaveLength(3);
  });
});

describe("simulation tenant/actor isolation", () => {
  it("fails closed across tenant and actor boundaries", () => {
    const store = makeStore();
    expect(
      store.configureSimulation({ organizationId: "org-other", clientId: "c-grant", roundToCents: 100, multiplier: 1, enabled: true, actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "CLIENT_NOT_FOUND" });
    expect(
      store.addVirtualTransaction({ organizationId: ORG, clientId: "c-grant", label: "x", amountCents: 100, occurredOn: "2026-07-15", actorStaffId: "s-intruder" }),
    ).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(store.simulationFor("org-other", "c-grant")).toBeNull();
  });
});

describe("seed integrity", () => {
  it("seeds round-up amounts consistent with the calculator", () => {
    for (const t of syntheticDatabase.virtualTransactions) {
      const s = syntheticDatabase.simulationSettings.find((x) => x.clientId === t.clientId)!;
      expect(t.roundUpAmountCents).toBe(roundUpAmountCents(t.amountCents, s.roundToCents, s.multiplier));
    }
  });

  it("never mutates the module-level seed", () => {
    const store = makeStore();
    store.addVirtualTransaction({ organizationId: ORG, clientId: "c-grant", label: "x", amountCents: 500, occurredOn: "2026-07-15", actorStaffId: "s-mercer" });
    const seededCount = syntheticDatabase.virtualTransactions.filter((t) => t.clientId === "c-grant").length;
    expect(seededCount).toBe(5);
  });
});
