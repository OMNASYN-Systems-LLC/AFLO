import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { Table, getTableColumns, getTableName, is } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import * as schema from "../src/schema";

/**
 * Row-Level Security coverage. The tenant set is DERIVED from the schema (every
 * table with an organization_id column), so a new tenant table that ships
 * without RLS fails this test. Global tables (organizations, users,
 * rule_versions) must NOT be RLS-forced. This asserts the DDL is PRESENT and
 * well-formed across the migration set; rls-runtime.test.ts proves it actually
 * ENFORCES isolation by applying the migrations to an in-memory Postgres and
 * querying under a non-superuser role.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

const migrationSql = readdirSync(migrationsDir)
  .filter((f) => f.endsWith(".sql"))
  .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
  .join("\n");

const tables = Object.values(schema).filter((v) => is(v, Table)) as Table[];

function hasOrgId(table: Table): boolean {
  return Object.values(getTableColumns(table)).some((c) => c.name === "organization_id");
}

const tenantTables = tables.filter(hasOrgId).map(getTableName);
const globalTables = tables.filter((t) => !hasOrgId(t)).map(getTableName);

describe("RLS org isolation", () => {
  it("covers every tenant table (derived from the schema)", () => {
    expect(tenantTables.length).toBeGreaterThanOrEqual(26);
    const missing = tenantTables.filter(
      (name) =>
        !migrationSql.includes(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`) ||
        !migrationSql.includes(`ALTER TABLE "${name}" FORCE ROW LEVEL SECURITY`) ||
        !migrationSql.includes(`CREATE POLICY "org_isolation" ON "${name}"`),
    );
    expect(missing).toEqual([]);
  });

  it("does not force RLS on the global tables (organizations, users, rule_versions)", () => {
    expect(globalTables.sort()).toEqual(["organizations", "rule_versions", "users"]);
    for (const name of globalTables) {
      expect(migrationSql).not.toContain(`ALTER TABLE "${name}" ENABLE ROW LEVEL SECURITY`);
    }
  });

  it("fails closed: an unset OR empty context matches no row (nullif form, missing_ok=true)", () => {
    // Two ways the GUC can be non-org: unset and cleared-to-empty-string.
    //  - missing_ok=true makes current_setting return NULL (not error) when unset.
    //  - nullif(..., '') maps a cleared '' to NULL rather than raising on ''::uuid.
    // NULL never equals organization_id, so both cases expose zero rows.
    expect(migrationSql).toContain("nullif(current_setting('app.current_org_id', true), '')::uuid");
    // Never the bare/erroring forms that would raise on unset or empty context.
    expect(migrationSql).not.toContain("current_setting('app.current_org_id')::uuid"); // implicit missing_ok=false
    expect(migrationSql).not.toContain("= current_setting('app.current_org_id', true)::uuid"); // un-nullif'd: errors on ''
  });
});
