import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TenantContextError, withOrgContext } from "../src/request-context";
import { outbox } from "../src/schema";

/**
 * Proves `withOrgContext` enforces per-request tenant isolation via a
 * TRANSACTION-LOCAL org GUC on a real (in-memory) Postgres under a non-superuser
 * role — and, critically, that the context does NOT leak out of the transaction
 * onto the connection (the failure mode a session-level setting would have under
 * connection pooling). Credential-free (PGlite).
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function allMigrations(): string {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replaceAll("--> statement-breakpoint", "");
}

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const ORG_B = "00000000-0000-0000-0000-0000000000bb";

let pg: PGlite;
let db: PgliteDatabase;

async function outboxOrgIdsRaw(): Promise<string[]> {
  const res = await pg.query<{ organization_id: string }>("SELECT organization_id FROM outbox");
  return res.rows.map((r) => r.organization_id);
}

/** Read the outbox org ids visible INSIDE a withOrgContext transaction for `org`. */
async function outboxOrgIdsIn(org: string): Promise<string[]> {
  return withOrgContext(db, org, async (tx) => {
    const rows = await tx.select({ organizationId: outbox.organizationId }).from(outbox);
    return rows.map((r) => r.organizationId);
  });
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
    INSERT INTO outbox (event_id, event_type, event_version, organization_id, aggregate_type, aggregate_id, payload) VALUES
      (gen_random_uuid(), 'DemoEvent', 1, '${ORG_A}', 'demo', 'agg-a', '{}'::jsonb),
      (gen_random_uuid(), 'DemoEvent', 1, '${ORG_B}', 'demo', 'agg-b', '{}'::jsonb);
  `);
  // Become the plain runtime role so RLS applies exactly as in production.
  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
});

afterAll(async () => {
  await pg?.close();
});

describe("withOrgContext — transaction-local tenant scoping", () => {
  it("scopes queries inside the transaction to the given organization", async () => {
    expect(await outboxOrgIdsIn(ORG_A)).toEqual([ORG_A]);
  });

  it("does NOT leak the org context onto the connection after the transaction commits", async () => {
    await withOrgContext(db, ORG_A, async (tx) => {
      await tx.execute(sql`SELECT organization_id FROM outbox`);
    });
    // Same connection, now OUTSIDE any withOrgContext: the transaction-local GUC
    // has reverted, so there is no org context → RLS fails closed → zero rows.
    // A session-level setting would still show ORG_A's row here (the leak).
    expect(await outboxOrgIdsRaw()).toEqual([]);
  });

  it("gives each transaction only its own org (no cross-request leak)", async () => {
    expect(await outboxOrgIdsIn(ORG_A)).toEqual([ORG_A]);
    expect(await outboxOrgIdsIn(ORG_B)).toEqual([ORG_B]);
  });

  it("rejects a cross-tenant write (RLS WITH CHECK backstop) and does not leak after rollback", async () => {
    // The insert targets ORG_B while scoped to ORG_A → RLS rejects it (the exact
    // "row-level security" message is asserted on raw queries in rls-runtime.test.ts;
    // here we assert the wrapper propagates the rejection and rolls back).
    await expect(
      withOrgContext(db, ORG_A, async (tx) => {
        await tx.execute(
          sql`INSERT INTO outbox (event_id, event_type, event_version, organization_id, aggregate_type, aggregate_id, payload)
              VALUES (gen_random_uuid(), 'DemoEvent', 1, ${ORG_B}, 'demo', 'agg-x', '{}'::jsonb)`,
        );
      }),
    ).rejects.toThrow();
    // the connection context reverted even though the tx rolled back
    expect(await outboxOrgIdsRaw()).toEqual([]);
  });

  it("fails closed (throws, opens no transaction) on an empty organization id", async () => {
    await expect(withOrgContext(db, "   ", async () => "unreached")).rejects.toBeInstanceOf(TenantContextError);
    expect(await outboxOrgIdsRaw()).toEqual([]);
  });
});
