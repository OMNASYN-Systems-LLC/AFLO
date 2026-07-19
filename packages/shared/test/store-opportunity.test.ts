import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { syntheticDatabase, type SyntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore(seed: SyntheticDatabase = syntheticDatabase) {
  return new AfloStore(seed, () => NOW);
}

// c-grant has a savings goal (aligns housing/assistance programs) and is not
// mutated by other specs' workflows.
describe("opportunityNoticesFor — surface-worthy notices, review-gated", () => {
  it("surfaces relevant federal notices for a client (US default jurisdiction)", () => {
    const store = makeStore();
    const notices = store.opportunityNoticesFor(ORG, "c-grant", NOW);
    const ids = notices.map((n) => n.noticeId);
    expect(ids).toContain("opp-irs-savers"); // broadly applicable tax update
    expect(ids).toContain("opp-hud-counsel"); // housing program, savings-goal aligned
    // A state program does NOT surface without a known client jurisdiction.
    expect(ids).not.toContain("opp-ca-dpa");
  });

  it("NEVER auto-projects a legal/claims notice to a client (review gate)", () => {
    const store = makeStore();
    const settlement = store
      .opportunityNoticesFor(ORG, "c-grant", NOW)
      .find((n) => n.noticeId === "opp-cfpb-settlement");
    expect(settlement).toBeDefined();
    expect(settlement?.requiresReview).toBe(true);
    expect(settlement?.clientSafe).toBeNull(); // not client-projected without staff approval
  });

  it("every client-safe projection is hedged and carries no dollar figure", () => {
    const store = makeStore();
    for (const n of store.opportunityNoticesFor(ORG, "c-grant", NOW)) {
      if (n.clientSafe) {
        expect(n.clientSafe.message).toMatch(/may relate to your profile/i);
        expect(n.clientSafe.message).not.toMatch(/\$/);
      }
    }
  });

  it("honors an explicit jurisdiction: a CA program surfaces for a CA client with an aligned goal", () => {
    const store = makeStore();
    const notices = store.opportunityNoticesFor(ORG, "c-grant", NOW, "US-CA");
    const dpa = notices.find((n) => n.noticeId === "opp-ca-dpa");
    expect(dpa).toBeDefined();
    expect(dpa?.requiresReview).toBe(false);
    expect(dpa?.clientSafe).not.toBeNull();
  });

  it("fails closed on org scope: unknown / foreign-org client returns []", () => {
    const store = makeStore();
    expect(store.opportunityNoticesFor(ORG, "c-nope", NOW)).toEqual([]);
    expect(store.opportunityNoticesFor("org-not-mine", "c-grant", NOW)).toEqual([]);
  });

  it("is a pure read: no mutation, no event, no audit", () => {
    const store = makeStore();
    const outboxBefore = store.outbox.length;
    const auditBefore = store.auditFor(ORG).length;
    store.opportunityNoticesFor(ORG, "c-grant", NOW);
    store.opportunityNoticesFor(ORG, "c-grant", NOW, "US-CA");
    expect(store.outbox.length).toBe(outboxBefore);
    expect(store.auditFor(ORG).length).toBe(auditBefore);
  });
});
