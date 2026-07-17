import { describe, expect, it } from "vitest";
import { SYNTHETIC_NOW, syntheticDatabase } from "../src/data/synthetic";
import { MockClientRepository, MockDashboardRepository } from "../src/repositories/mock";
import { LIFECYCLE_STAGES } from "../src/domain/types";

const ORG = syntheticDatabase.organization.id;
const clients = new MockClientRepository();
const dashboard = new MockDashboardRepository();

describe("organization isolation", () => {
  it("returns nothing for a foreign organization", async () => {
    expect(await clients.list("org-other", SYNTHETIC_NOW)).toEqual([]);
    expect(await clients.getDetail("org-other", "c-whitaker", SYNTHETIC_NOW)).toBeNull();
    await expect(dashboard.getSnapshot("org-other", SYNTHETIC_NOW)).rejects.toThrow(
      /unknown organization/,
    );
  });
});

describe("client list", () => {
  it("lists every synthetic record, clients before leads", async () => {
    const rows = await clients.list(ORG, SYNTHETIC_NOW);
    expect(rows).toHaveLength(syntheticDatabase.clients.length);
    const firstLead = rows.findIndex((r) => r.kind === "lead");
    expect(rows.slice(firstLead).every((r) => r.kind === "lead")).toBe(true);
  });

  it("computes stages deterministically from profiles", async () => {
    const rows = await clients.list(ORG, SYNTHETIC_NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("c-bell")?.stage).toBe("recovery");
    expect(byId.get("c-grant")?.stage).toBe("stabilization");
    expect(byId.get("c-solomon")?.stage).toBe("credit_readiness");
    expect(byId.get("c-okafor")?.stage).toBe("capital_readiness");
    expect(byId.get("c-whitaker")?.stage).toBe("acquisition");
    // Leads without complete intake have no stage.
    expect(byId.get("l-cole")?.stage).toBeNull();
    expect(byId.get("l-haddad")?.stage).toBeNull();
  });

  it("derives engagement from activity recency", async () => {
    const rows = await clients.list(ORG, SYNTHETIC_NOW);
    const byId = new Map(rows.map((r) => [r.id, r]));
    expect(byId.get("c-ngo")?.engagement).toBe("dormant");
    expect(byId.get("l-lawson")?.engagement).toBe("at_risk");
    expect(byId.get("c-pryor")?.engagement).toBe("cooling");
    expect(byId.get("c-whitaker")?.engagement).toBe("active");
  });
});

describe("client detail", () => {
  it("assembles the full view for an assessed client", async () => {
    const detail = await clients.getDetail(ORG, "c-whitaker", SYNTHETIC_NOW);
    expect(detail).not.toBeNull();
    expect(detail?.assessment?.stage).toBe("acquisition");
    expect(detail?.assessment?.ruleVersion).toBe("readiness.v1.0.0");
    expect(detail?.derived?.utilizationPct).toBe(5);
    expect(detail?.milestones.map((m) => m.order)).toEqual([1, 2, 3, 4]);
    expect(detail?.latestReport?.quarter).toBe("2026-Q2");
    expect(detail?.nextAppointment?.appointment.id).toBe("ap-whitaker");
    expect(detail?.aiSuggestions).toHaveLength(1);
    expect(detail?.aiSuggestions[0]?.reviewStatus).toBe("pending_review");
  });

  it("returns a null assessment while intake is incomplete", async () => {
    const detail = await clients.getDetail(ORG, "l-haddad", SYNTHETIC_NOW);
    expect(detail?.financialProfile).not.toBeNull();
    expect(detail?.creditProfile).toBeNull();
    expect(detail?.assessment).toBeNull();
    expect(detail?.derived).toBeNull();
  });

  it("returns null for an unknown id", async () => {
    expect(await clients.getDetail(ORG, "c-nope", SYNTHETIC_NOW)).toBeNull();
  });
});

describe("dashboard snapshot", () => {
  it("aggregates KPIs from the synthetic dataset", async () => {
    const snap = await dashboard.getSnapshot(ORG, SYNTHETIC_NOW);
    expect(snap.kpis.activeClients).toBe(7);
    expect(snap.kpis.openLeads).toBe(4);
    expect(snap.kpis.atRiskOrDormant).toBe(2);
    expect(snap.kpis.documentsAwaitingReview).toBe(5);
    expect(snap.kpis.appointmentsNext7Days).toBe(5);
    expect(snap.kpis.monthlyActionCompletionPct).toBe(29);
  });

  it("covers all eight lifecycle stages in order, including zero counts", async () => {
    const snap = await dashboard.getSnapshot(ORG, SYNTHETIC_NOW);
    expect(snap.stageDistribution.map((s) => s.stage)).toEqual([...LIFECYCLE_STAGES]);
    const counts = Object.fromEntries(snap.stageDistribution.map((s) => [s.stage, s.count]));
    expect(counts).toMatchObject({
      recovery: 1,
      stabilization: 2,
      credit_readiness: 2,
      capital_readiness: 2,
      acquisition: 1,
      maintenance: 0,
      growth: 0,
      legacy: 0,
    });
  });

  it("surfaces retention and review work in needsAttention", async () => {
    const snap = await dashboard.getSnapshot(ORG, SYNTHETIC_NOW);
    const kinds = snap.needsAttention.map((n) => `${n.kind}:${n.clientId}`);
    expect(kinds).toContain("engagement:c-ngo");
    expect(kinds).toContain("engagement:l-lawson");
    expect(kinds).toContain("document:c-whitaker");
    expect(kinds).toContain("review:c-solomon");
  });
});
