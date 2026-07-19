import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { syntheticDatabase, type SyntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore(seed: SyntheticDatabase = syntheticDatabase) {
  return new AfloStore(seed, () => NOW);
}

describe("resolutionReadoutFor — governed read-only composition", () => {
  it("composes the readout from the client's recorded facts", () => {
    const store = makeStore();
    const readout = store.resolutionReadoutFor(ORG, "c-whitaker", NOW);
    expect(readout).not.toBeNull();
    expect(readout?.clientId).toBe("c-whitaker");
    // Whitaker has both profiles seeded → understanding is complete and obligations exist.
    expect(readout?.understanding.canDiagnose).toBe(true);
    expect(readout?.obligations).not.toBeNull();
    expect(readout?.generatedAt).toBe(NOW.toISOString());
  });

  it("mirrors the LATEST recorded assessment verbatim (never re-runs the diagnosis)", () => {
    const store = makeStore();
    const latest = store.assessmentsFor(ORG, "c-whitaker").at(-1);
    const readout = store.resolutionReadoutFor(ORG, "c-whitaker", NOW);
    expect(readout?.diagnosis?.stage).toBe(latest?.stage);
    expect(readout?.diagnosis?.reasonCodes).toEqual(latest?.reasonCodes);
    expect(readout?.diagnosis?.bindingBlocker).toBe(latest?.reasonCodes[0] ?? null);
    expect(readout?.diagnosis?.assessedAt).toBe(latest?.assessedAt);
  });

  it("is a pure read: mutates nothing, emits no event, writes no audit", () => {
    const store = makeStore();
    const outboxBefore = store.outbox.length;
    const auditBefore = store.auditFor(ORG).length;
    store.resolutionReadoutFor(ORG, "c-whitaker", NOW);
    store.resolutionReadoutFor(ORG, "c-whitaker", NOW);
    expect(store.outbox.length).toBe(outboxBefore);
    expect(store.auditFor(ORG).length).toBe(auditBefore);
  });

  it("fails closed: unknown client returns null", () => {
    const store = makeStore();
    expect(store.resolutionReadoutFor(ORG, "c-does-not-exist", NOW)).toBeNull();
  });

  it("fails closed: a foreign organization id returns null", () => {
    const store = makeStore();
    expect(store.resolutionReadoutFor("org-not-mine", "c-whitaker", NOW)).toBeNull();
  });

  it("defaults `now` to the store clock when omitted", () => {
    const store = makeStore();
    const readout = store.resolutionReadoutFor(ORG, "c-whitaker");
    expect(readout?.generatedAt).toBe(NOW.toISOString());
  });

  it("canRunDiagnosis reflects facts captured AND intake complete", () => {
    const store = makeStore();
    const readout = store.resolutionReadoutFor(ORG, "c-whitaker", NOW);
    // Whitaker has both profiles and a completed intake (readiness runs for him).
    expect(readout?.understanding.canDiagnose).toBe(true);
    expect(readout?.intakeComplete).toBe(true);
    expect(readout?.canRunDiagnosis).toBe(true);
  });
});
