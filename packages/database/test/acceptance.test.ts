import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapAcceptancePGlite, type AcceptancePGlite } from "../src/acceptance/bootstrap";
import { runAcceptance, ACCEPTANCE_CHECK_IDS } from "../src/acceptance/runner";
import { deriveTenantTables } from "../src/acceptance/checks";
import type { AcceptanceReport } from "../src/acceptance/types";

/**
 * CI wiring for the preview acceptance suite (ADR-0050): the FULL PGlite path
 * — fresh in-memory Postgres, runbook §2 role provisioning, the real drizzle
 * migrator, then every acceptance check — runs with the normal test suite.
 * This is the same code path `pnpm --filter @aflo/database acceptance` runs
 * with no env, and the same checks that must later pass against Neon PREVIEW
 * (via DATABASE_URL_ACCEPTANCE) before Neon main is ever touched.
 */

let target: AcceptancePGlite;
let report: AcceptanceReport;

beforeAll(async () => {
  target = await bootstrapAcceptancePGlite();
  report = await runAcceptance(target.db, { target: "pglite" });
}, 120_000);

afterAll(async () => {
  await target?.close();
});

describe("preview acceptance suite — full PGlite path", () => {
  it("every acceptance check passes against a fresh migrated database", () => {
    const failures = report.results.filter((r) => !r.passed);
    expect(
      failures,
      failures.map((f) => `${f.check}: ${f.detail}`).join("\n"),
    ).toEqual([]);
    expect(report.passed).toBe(true);
  });

  it("runs the complete pinned check list, in order", () => {
    expect(report.results.map((r) => r.check)).toEqual([...ACCEPTANCE_CHECK_IDS]);
  });

  it("reports the pglite target with timestamps", () => {
    expect(report.target).toBe("pglite");
    expect(Date.parse(report.startedAt)).not.toBeNaN();
    expect(Date.parse(report.finishedAt)).not.toBeNaN();
  });
});

describe("tenant-table derivation (schema.ts is the source of truth)", () => {
  it("derives exactly the org-RLS tenant tables (NOT NULL organization_id)", () => {
    // Pinned so adding a tenant table is a CONSCIOUS update here — the check
    // itself derives from schema.ts and would silently cover a new table.
    expect(deriveTenantTables()).toEqual(
      [
        "ai_runs",
        "appointments",
        "audit_events",
        "client_user_links",
        "clients",
        "communications",
        "consent_records",
        "conversation_threads",
        "credit_profiles",
        "documents",
        "education_assignments",
        "financial_profiles",
        "goals",
        "handoff_packages",
        "intakes",
        "invitations",
        "messages",
        "monthly_actions",
        "notes",
        "notification_preferences",
        "organization_members",
        "outbox",
        "partner_referrals",
        "partners",
        "playbook_versions",
        "playbooks",
        "quarterly_reports",
        "readiness_assessments",
        "review_decisions",
        "review_items",
        "roadmap_milestones",
        "roadmaps",
        "simulation_settings",
        "virtual_transactions",
        "workflow_discovery_items",
      ].sort(),
    );
  });

  it("excludes the global / resolver-path tables (no org RLS by design)", () => {
    const tenantTables = deriveTenantTables();
    for (const excluded of [
      "organizations",
      "users",
      "rule_versions",
      "identity_provider_accounts",
      "provider_webhook_events",
      "session_revocations",
    ]) {
      expect(tenantTables).not.toContain(excluded);
    }
  });
});

describe("acceptance checks detect drift (not just a happy path)", () => {
  it("fails rls.tenant_tables_enforced when a policy is dropped", async () => {
    // Drop one policy in-place, re-run, then restore. Proves the aggregate
    // check actually reads the target rather than echoing the schema.
    await target.pglite.exec(`DROP POLICY "org_isolation" ON "goals";`);
    const rerun = await runAcceptance(target.db, { target: "pglite" });
    const rls = rerun.results.find((r) => r.check === "rls.tenant_tables_enforced");
    expect(rls?.passed).toBe(false);
    expect(rls?.detail).toContain("goals");
    await target.pglite.exec(
      `CREATE POLICY "org_isolation" ON "goals" AS PERMISSIVE FOR ALL
       USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid)
       WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);`,
    );
    const restored = await runAcceptance(target.db, { target: "pglite" });
    expect(restored.results.find((r) => r.check === "rls.tenant_tables_enforced")?.passed).toBe(true);
  }, 60_000);

  it("fails roles.tenant_role_posture when aflo_app gains BYPASSRLS", async () => {
    await target.pglite.exec("ALTER ROLE aflo_app BYPASSRLS;");
    const rerun = await runAcceptance(target.db, { target: "pglite" });
    expect(rerun.results.find((r) => r.check === "roles.tenant_role_posture")?.passed).toBe(false);
    await target.pglite.exec("ALTER ROLE aflo_app NOBYPASSRLS;");
  }, 60_000);
});
