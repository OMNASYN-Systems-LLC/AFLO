import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  appointments,
  creditProfiles,
  documents,
  financialProfiles,
  goals,
  monthlyActions,
  notes,
  quarterlyReports,
  readinessAssessments,
  roadmapMilestones,
  roadmaps,
  simulationSettings,
  virtualTransactions,
} from "../src/schema";

/**
 * Phase A1 table invariants. The RLS defense-in-depth (a later slice) enforces
 * `organization_id = current_setting(...)` on every tenant-owned row, so each
 * table MUST carry organization_id; and every client-scoped table carries
 * client_id. These checks read the Drizzle column metadata (no live DB).
 */

const A1_TABLES = {
  readiness_assessments: readinessAssessments,
  financial_profiles: financialProfiles,
  credit_profiles: creditProfiles,
  goals,
  roadmaps,
  roadmap_milestones: roadmapMilestones,
  monthly_actions: monthlyActions,
  documents,
  appointments,
  quarterly_reports: quarterlyReports,
  notes,
  simulation_settings: simulationSettings,
  virtual_transactions: virtualTransactions,
} as const;

function columnNames(table: (typeof A1_TABLES)[keyof typeof A1_TABLES]): string[] {
  return Object.values(getTableColumns(table)).map((c) => c.name);
}

describe("Phase A1 table invariants", () => {
  it("every tenant table carries organization_id (RLS enforcement point)", () => {
    const missing = Object.entries(A1_TABLES)
      .filter(([, table]) => !columnNames(table).includes("organization_id"))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("every A1 table is client-scoped via client_id", () => {
    const missing = Object.entries(A1_TABLES)
      .filter(([, table]) => !columnNames(table).includes("client_id"))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("money columns are integer cents (bigint), never numeric/float", () => {
    const centsColumns = [financialProfiles, creditProfiles, virtualTransactions].flatMap((table) =>
      Object.values(getTableColumns(table)).filter((c) => c.name.endsWith("_cents")),
    );
    expect(centsColumns.length).toBeGreaterThan(0);
    for (const col of centsColumns) {
      expect(col.getSQLType()).toBe("bigint");
    }
  });

  it("appointments has no status column (the domain Appointment has no status field)", () => {
    expect(columnNames(appointments)).not.toContain("status");
    expect(columnNames(appointments)).toContain("channel");
  });

  it("goals.target_date is NOT NULL (matches non-null Goal.targetDate)", () => {
    const targetDate = Object.values(getTableColumns(goals)).find((c) => c.name === "target_date");
    expect(targetDate?.notNull).toBe(true);
  });
});
