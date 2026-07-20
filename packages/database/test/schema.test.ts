import { getTableColumns } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  aiRuns,
  appointments,
  communications,
  conversationThreads,
  creditProfiles,
  documents,
  educationAssignments,
  financialProfiles,
  goals,
  handoffPackages,
  messages,
  monthlyActions,
  notes,
  notificationPreferences,
  partnerReferrals,
  partners,
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

/** All A1 tenant-owned tables — each MUST carry organization_id. */
const A1_TENANT_TABLES = {
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
  // A1b
  ai_runs: aiRuns,
  partners,
  partner_referrals: partnerReferrals,
  education_assignments: educationAssignments,
  notification_preferences: notificationPreferences,
  communications,
  handoff_packages: handoffPackages,
} as const;

/** Client-scoped A1 tables — each MUST carry client_id. (partners is a
 *  directory and notification_preferences is user-scoped, so they are excluded.) */
const A1_CLIENT_TABLES = {
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
  ai_runs: aiRuns,
  partner_referrals: partnerReferrals,
  education_assignments: educationAssignments,
  communications,
  handoff_packages: handoffPackages,
} as const;

function columnNames(table: Parameters<typeof getTableColumns>[0]): string[] {
  return Object.values(getTableColumns(table)).map((c) => c.name);
}

describe("Phase A1 table invariants", () => {
  it("every tenant table carries organization_id (RLS enforcement point)", () => {
    const missing = Object.entries(A1_TENANT_TABLES)
      .filter(([, table]) => !columnNames(table).includes("organization_id"))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("every client-scoped A1 table carries client_id", () => {
    const missing = Object.entries(A1_CLIENT_TABLES)
      .filter(([, table]) => !columnNames(table).includes("client_id"))
      .map(([name]) => name);
    expect(missing).toEqual([]);
  });

  it("partner directory and notification preferences are not client-scoped", () => {
    expect(columnNames(partners)).not.toContain("client_id");
    expect(columnNames(notificationPreferences)).toContain("user_id");
    expect(columnNames(notificationPreferences)).not.toContain("client_id");
  });

  it("handoff_packages payload_digest is present but not a unique index (re-issue after revoke must not collide)", () => {
    expect(columnNames(handoffPackages)).toContain("payload_digest");
    expect(columnNames(handoffPackages)).toContain("revoked_at");
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

describe("secure-messaging table invariants (PHASE 10)", () => {
  it("both messaging tables carry organization_id (RLS enforcement point) and client_id", () => {
    for (const table of [conversationThreads, messages]) {
      expect(columnNames(table)).toContain("organization_id");
      expect(columnNames(table)).toContain("client_id");
    }
  });

  it("messages store the body ONLY as bytea ciphertext — no plaintext body column", () => {
    const cols = Object.values(getTableColumns(messages));
    const names = cols.map((c) => c.name);
    // The single body column is the encrypted bytea one; a plaintext `body` must not exist.
    expect(names).toContain("body_encrypted");
    expect(names).not.toContain("body");
    const body = cols.find((c) => c.name === "body_encrypted");
    expect(body?.getSQLType()).toBe("bytea");
    expect(body?.notNull).toBe(true);
  });

  it("messages record sender + read receipts for both sides", () => {
    const names = columnNames(messages);
    expect(names).toContain("sender_role");
    expect(names).toContain("sender_id");
    expect(names).toContain("read_by_client_at");
    expect(names).toContain("read_by_staff_at");
  });
});
