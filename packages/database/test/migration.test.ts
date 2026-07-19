import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { describe, expect, it } from "vitest";
import * as enums from "../src/enums";

/**
 * Migration integrity: every Postgres enum the schema declares must be
 * CREATE'd by a migration. drizzle-kit only emits CREATE TYPE for enums it
 * discovers via the config `schema` glob; when enums.ts was omitted, columns
 * referenced enum types that were never created and the migration could not
 * apply to a clean database. This guards that regression — the lockstep tests
 * check schema-as-code, not the generated SQL, so only this test would catch
 * it.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Concatenated SQL of every generated migration file (order-independent for CREATE TYPE checks). */
function allMigrationSql(): string {
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
  return files.map((f) => readFileSync(join(migrationsDir, f), "utf8")).join("\n");
}

/** Every pgEnum object exported by the schema (they carry enumName + enumValues). */
function declaredEnums(): { name: string; values: readonly string[] }[] {
  const out: { name: string; values: readonly string[] }[] = [];
  for (const value of Object.values(enums)) {
    if (value && typeof value === "object" && "enumName" in value && "enumValues" in value) {
      const e = value as { enumName: string; enumValues: readonly string[] };
      if (typeof e.enumName === "string") out.push({ name: e.enumName, values: e.enumValues });
    }
  }
  return out;
}

describe("migration integrity", () => {
  it("declares at least one migration", () => {
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql"));
    expect(files.length).toBeGreaterThan(0);
  });

  it("creates a CREATE TYPE for every declared enum (so a clean DB can apply)", () => {
    const sql = allMigrationSql();
    const missing = declaredEnums()
      .map((e) => e.name)
      .filter((name) => !sql.includes(`CREATE TYPE "public"."${name}"`));
    expect(missing).toEqual([]);
  });

  it("has no orphan enum column reference without a CREATE TYPE", () => {
    const sql = allMigrationSql();
    const created = new Set(
      [...sql.matchAll(/CREATE TYPE "public"\."(\w+)"/g)].map((m) => m[1]),
    );
    // Enum columns render as `"col" "enum_type"`; the custom encrypted column
    // renders as `"col" "bytea"`, which is not an enum type — exclude it.
    const referenced = new Set(
      [...sql.matchAll(/^\s+"\w+" "(\w+)"/gm)].map((m) => m[1]).filter((t) => t !== "bytea"),
    );
    const orphans = [...referenced].filter((t) => !created.has(t));
    expect(orphans).toEqual([]);
  });
});
