import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { syntheticDatabase, type SyntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore(seed: SyntheticDatabase = syntheticDatabase) {
  return new AfloStore(seed, () => NOW);
}

/** A seed with data-processing consent for c-bell, who has no synthetic report. */
function seedWithConsentNoReport(): SyntheticDatabase {
  const seed = structuredClone(syntheticDatabase);
  seed.consentRecords.push({
    userId: "c-bell",
    consentType: "data_processing",
    granted: true,
    recordedAt: "2026-01-01T00:00:00.000Z",
  });
  return seed;
}

describe("creditReportSummaryFor — display-only, consent-gated credit summary", () => {
  it("returns a summarized report for a consented client with a synthetic report", async () => {
    const store = makeStore();
    const summary = await store.creditReportSummaryFor(ORG, "c-solomon", NOW);
    expect(summary?.available).toBe(true);
    expect(summary?.reason).toBeNull();
    expect(summary?.source).toBe("mock");
    expect(summary?.isProduction).toBe(false); // never a bureau in V1
    expect(summary?.staffVerified).toBe(false); // unverified reported data
    expect(summary?.facts?.primaryScore).toBe(672);
    expect(summary?.facts?.utilizationPct).toBe(35.3); // 300000 / 850000
  });

  it("fails closed on consent: a client without data_processing consent gets no facts", async () => {
    const store = makeStore();
    // c-bell has no data_processing consent in the base seed.
    const summary = await store.creditReportSummaryFor(ORG, "c-bell", NOW);
    expect(summary?.available).toBe(false);
    expect(summary?.reason).toBe("consent_required");
    expect(summary?.facts).toBeNull();
  });

  it("reports no_report when consent is granted but no synthetic report exists", async () => {
    const store = makeStore(seedWithConsentNoReport());
    const summary = await store.creditReportSummaryFor(ORG, "c-bell", NOW);
    expect(summary?.available).toBe(false);
    expect(summary?.reason).toBe("no_report");
    expect(summary?.facts).toBeNull();
  });

  it("fails closed on org scope: unknown and foreign-org clients return null", async () => {
    const store = makeStore();
    expect(await store.creditReportSummaryFor(ORG, "c-nope", NOW)).toBeNull();
    expect(await store.creditReportSummaryFor("org-not-mine", "c-solomon", NOW)).toBeNull();
  });

  it("is a pure read: no mutation, no event, no audit", async () => {
    const store = makeStore();
    const outboxBefore = store.outbox.length;
    const auditBefore = store.auditFor(ORG).length;
    await store.creditReportSummaryFor(ORG, "c-solomon", NOW);
    await store.creditReportSummaryFor(ORG, "c-bell", NOW);
    expect(store.outbox.length).toBe(outboxBefore);
    expect(store.auditFor(ORG).length).toBe(auditBefore);
  });

  it("NEVER alters the manual CreditProfile or the recorded readiness assessments", async () => {
    const store = makeStore();
    const creditBefore = JSON.stringify(store.database().creditProfiles);
    const assessmentsBefore = JSON.stringify(store.assessmentsFor(ORG, "c-solomon"));
    await store.creditReportSummaryFor(ORG, "c-solomon", NOW);
    expect(JSON.stringify(store.database().creditProfiles)).toBe(creditBefore);
    expect(JSON.stringify(store.assessmentsFor(ORG, "c-solomon"))).toBe(assessmentsBefore);
  });

  it("defaults `now` to the store clock when omitted", async () => {
    const store = makeStore();
    const summary = await store.creditReportSummaryFor(ORG, "c-solomon");
    expect(summary?.available).toBe(true);
  });
});
