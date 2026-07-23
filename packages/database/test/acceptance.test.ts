import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { bootstrapAcceptancePGlite, type AcceptancePGlite } from "../src/acceptance/bootstrap";
import { runAcceptance, ACCEPTANCE_CHECK_IDS } from "../src/acceptance/runner";
import { deriveTenantTables } from "../src/acceptance/checks";
import * as acceptancePublic from "../src/acceptance";
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

describe("M1: the guarded factory is the ONLY remote-handle path", () => {
  const acceptanceDir = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "acceptance");

  /** Source with comments stripped, so grep-asserts test CODE, not documentation. */
  const codeOf = (file: string): string =>
    readFileSync(join(acceptanceDir, file), "utf8")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");

  it("connectRemoteAcceptanceDb is exported; acceptanceDbFromPgPool is NOT on the package surface", () => {
    expect(typeof (acceptancePublic as Record<string, unknown>).connectRemoteAcceptanceDb).toBe("function");
    expect((acceptancePublic as Record<string, unknown>).acceptanceDbFromPgPool).toBeUndefined();
    // The PGlite adapter (guard-free but local-only) stays public for bootstrap.
    expect(typeof (acceptancePublic as Record<string, unknown>).acceptanceDbFromPGlite).toBe("function");
  });

  it("the public index re-exports neither the pool adapter nor bootstrap/cli", () => {
    const index = codeOf("index.ts");
    expect(index).not.toMatch(/export\s+\*\s+from\s+["']\.\/db["']/);
    expect(index).not.toContain("acceptanceDbFromPgPool");
    expect(index).not.toMatch(/from\s+["']\.\/bootstrap["']/);
    expect(index).not.toMatch(/from\s+["']\.\/cli["']/);
  });

  it("the ONLY module that constructs a remote pg Pool is remote.ts", () => {
    const files = readdirSync(acceptanceDir).filter((f) => f.endsWith(".ts"));
    const poolConstructors = files.filter((f) => /new Pool\s*\(/.test(codeOf(f)));
    expect(poolConstructors).toEqual(["remote.ts"]);
  });

  it("the ONLY module that references acceptanceDbFromPgPool in CODE is remote.ts (plus its db.ts definition)", () => {
    const files = readdirSync(acceptanceDir).filter((f) => f.endsWith(".ts"));
    const callers = files.filter((f) => codeOf(f).includes("acceptanceDbFromPgPool")).sort();
    // db.ts defines it; remote.ts imports+uses it; NO other module (incl. index.ts) references it in code.
    expect(callers).toEqual(["db.ts", "remote.ts"]);
  });

  it("the guarded factory refuses the C1 (?host=) and C2 (%61) bypass URLs without connecting", () => {
    const c1 = acceptancePublic.connectRemoteAcceptanceDb(
      "postgresql://u:p@ep-aflo-preview-1.aws.neon.tech/aflo?host=ep-aflo-main-1.aws.neon.tech",
      { ACCEPTANCE_CONFIRM_NON_MAIN: "ep-aflo-preview-1.aws.neon.tech" },
    );
    expect(c1.ok).toBe(false);
    const c2 = acceptancePublic.connectRemoteAcceptanceDb("postgresql://u:p@ep-m%61in-1.aws.neon.tech/aflo", {
      ACCEPTANCE_CONFIRM_NON_MAIN: "ep-main-1.aws.neon.tech",
    });
    expect(c2.ok).toBe(false);
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

  it("L2: fails rls.tenant_tables_enforced when a policy's USING clause is ALTERED", async () => {
    // Not a drop — a subtly WEAKENED policy (drops the nullif fail-closed shape).
    // Recreate goals' policy with a bare cast that would ERROR on '' instead of
    // failing closed; the exact-shape check must catch it.
    await target.pglite.exec(`DROP POLICY "org_isolation" ON "goals";`);
    await target.pglite.exec(
      `CREATE POLICY "org_isolation" ON "goals" AS PERMISSIVE FOR ALL
         USING ("organization_id" = current_setting('app.current_org_id', true)::uuid)
         WITH CHECK ("organization_id" = current_setting('app.current_org_id', true)::uuid);`,
    );
    const rerun = await runAcceptance(target.db, { target: "pglite" });
    const rls = rerun.results.find((r) => r.check === "rls.tenant_tables_enforced");
    expect(rls?.passed).toBe(false);
    expect(rls?.detail).toMatch(/goals: (USING|WITH CHECK) expression differs/);
    // Restore the exact fail-closed policy.
    await target.pglite.exec(`DROP POLICY "org_isolation" ON "goals";`);
    await target.pglite.exec(
      `CREATE POLICY "org_isolation" ON "goals" AS PERMISSIVE FOR ALL
         USING ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid)
         WITH CHECK ("organization_id" = nullif(current_setting('app.current_org_id', true), '')::uuid);`,
    );
    expect((await runAcceptance(target.db, { target: "pglite" })).results.find((r) => r.check === "rls.tenant_tables_enforced")?.passed).toBe(true);
  }, 60_000);

  it("M3a: fails rls.tenant_tables_enforced when RLS is enabled on an UNEXPECTED (non-tenant) table", async () => {
    // Enabling RLS on the global `users` table (resolver path) must be caught by
    // the set-equality absence check — it is NOT a derived tenant table.
    await target.pglite.exec(`ALTER TABLE "users" ENABLE ROW LEVEL SECURITY;`);
    const rerun = await runAcceptance(target.db, { target: "pglite" });
    const rls = rerun.results.find((r) => r.check === "rls.tenant_tables_enforced");
    expect(rls?.passed).toBe(false);
    expect(rls?.detail).toMatch(/users: has RLS\/policies but is NOT a derived tenant table/);
    await target.pglite.exec(`ALTER TABLE "users" DISABLE ROW LEVEL SECURITY;`);
    expect((await runAcceptance(target.db, { target: "pglite" })).results.find((r) => r.check === "rls.tenant_tables_enforced")?.passed).toBe(true);
  }, 60_000);

  it("M3b: fails grants.resolver_read_paths when the resolver gains a grant OUTSIDE the whitelist", async () => {
    // A manual GRANT on a tenant table to the BYPASSRLS resolver is exactly the
    // cross-tenant-read drift the absence check must catch.
    await target.pglite.exec(`GRANT SELECT ON "clients" TO aflo_auth_resolver;`);
    const rerun = await runAcceptance(target.db, { target: "pglite" });
    const grants = rerun.results.find((r) => r.check === "grants.resolver_read_paths");
    expect(grants?.passed).toBe(false);
    expect(grants?.detail).toMatch(/resolver holds SELECT on clients — OUTSIDE the whitelist/);
    await target.pglite.exec(`REVOKE SELECT ON "clients" FROM aflo_auth_resolver;`);
    expect((await runAcceptance(target.db, { target: "pglite" })).results.find((r) => r.check === "grants.resolver_read_paths")?.passed).toBe(true);
  }, 60_000);

  it("M2: the fail-closed smoke is SKIPPED (not failed) when runSmoke is false", async () => {
    const report = await runAcceptance(target.db, { target: "remote", runSmoke: false });
    const smoke = report.results.find((r) => r.check === "smoke.fail_closed_no_org_context");
    expect(smoke?.skipped).toBe(true);
    expect(smoke?.passed).toBe(false);
    expect(smoke?.detail).toMatch(/SKIPPED/);
    // A skipped check does not fail the suite (everything else passes here).
    expect(report.passed).toBe(true);
  }, 60_000);
});
