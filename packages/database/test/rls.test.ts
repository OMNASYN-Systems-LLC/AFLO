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
 * rule_versions) must NOT be RLS-forced. This asserts the DDL is present in a
 * migration; true runtime isolation (set app.current_org_id, assert zero
 * cross-tenant rows) needs a live/pglite Postgres and is a separate follow-up.
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

  it("fails closed: the policy uses current_setting(..., true) so an unset context matches no row", () => {
    // The missing_ok=true form returns NULL (not an error) when unset; NULL never
    // equals organization_id, so no rows are visible without an explicit org.
    expect(migrationSql).toContain("current_setting('app.current_org_id', true)::uuid");
    expect(migrationSql).not.toContain("current_setting('app.current_org_id')::uuid"); // never the erroring/implicit form
  });
});
