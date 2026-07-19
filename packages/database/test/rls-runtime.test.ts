import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runtime proof that the RLS DDL (migration 0003) actually ENFORCES org
 * isolation — not just that the statements are present in the file. We apply
 * every generated migration to an in-memory Postgres (PGlite, credential-free),
 * create a NON-SUPERUSER role, and query under that role. This matters because
 * the schema owner and superusers bypass RLS; only a plain role is subject to
 * the org_isolation policy the way the app's runtime connection will be.
 *
 * Coverage mirrors the tenancy threat model:
 *  - list isolation      — org A never sees org B's rows in an unfiltered scan
 *  - direct-id isolation — fetching a known foreign-org id by primary key is empty
 *  - write rejection     — WITH CHECK blocks writing a row into another org
 *  - matching write ok    — the policy isolates, it does not blanket-deny
 *  - fail closed (unset)  — no org context ⇒ zero rows
 *  - fail closed (empty)  — a cleared '' context ⇒ zero rows, not an error
 * The last case is exactly what the nullif(...) hardening buys over a bare
 * ::uuid cast, which would raise on ''.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

/** Every generated migration, in order, with drizzle's breakpoint markers stripped. */
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

let db: PGlite;
/** Primary keys of the seed rows, captured while seeding as the superuser. */
let outboxIdA = "";
let outboxIdB = "";
let clientIdB = "";

/** Set the per-session org context the app supplies from the server-verified org. */
async function useOrg(org: string): Promise<void> {
  await db.query("SELECT set_config('app.current_org_id', $1, false)", [org]);
}
/** Clear the context entirely (GUC unset ⇒ current_setting returns NULL). */
async function clearOrg(): Promise<void> {
  await db.exec("RESET app.current_org_id");
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(allMigrations());

  // Seed as the (superuser) owner, which bypasses RLS, so both orgs get rows.
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'),
      ('${ORG_B}', 'Org B', 'org-b');
  `);

  const a = await db.query<{ id: string }>(
    `INSERT INTO outbox (event_id, event_type, event_version, organization_id, aggregate_type, aggregate_id, payload)
     VALUES (gen_random_uuid(), 'DemoEvent', 1, $1, 'demo', 'agg-a', '{}'::jsonb) RETURNING id`,
    [ORG_A],
  );
  const b = await db.query<{ id: string }>(
    `INSERT INTO outbox (event_id, event_type, event_version, organization_id, aggregate_type, aggregate_id, payload)
     VALUES (gen_random_uuid(), 'DemoEvent', 1, $1, 'demo', 'agg-b', '{}'::jsonb) RETURNING id`,
    [ORG_B],
  );
  outboxIdA = a.rows[0]!.id;
  outboxIdB = b.rows[0]!.id;

  const cb = await db.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name)
     VALUES ($1, 'stage-new', 'Bee', 'Bravo') RETURNING id`,
    [ORG_B],
  );
  clientIdB = cb.rows[0]!.id;

  // Become a plain role: no superuser, no BYPASSRLS, not the table owner — so
  // RLS applies exactly as it will to the app's runtime database connection.
  await db.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
});

afterAll(async () => {
  await db?.close();
});

describe("RLS runtime isolation (non-superuser role, in-memory Postgres)", () => {
  it("list isolation: an unfiltered scan returns only the current org's rows", async () => {
    await useOrg(ORG_A);
    const a = await db.query<{ organization_id: string }>("SELECT organization_id FROM outbox");
    expect(a.rows).toHaveLength(1);
    expect(a.rows[0]!.organization_id).toBe(ORG_A);

    await useOrg(ORG_B);
    const b = await db.query<{ organization_id: string }>("SELECT organization_id FROM outbox");
    expect(b.rows).toHaveLength(1);
    expect(b.rows[0]!.organization_id).toBe(ORG_B);
  });

  it("direct-id isolation: fetching a foreign org's row by primary key is empty", async () => {
    await useOrg(ORG_A);
    const foreign = await db.query("SELECT id FROM outbox WHERE id = $1", [outboxIdB]);
    expect(foreign.rows).toHaveLength(0);
    const own = await db.query("SELECT id FROM outbox WHERE id = $1", [outboxIdA]);
    expect(own.rows).toHaveLength(1);
  });

  it("direct-id isolation holds on a foreign-keyed tenant table (clients)", async () => {
    await useOrg(ORG_A);
    const foreign = await db.query("SELECT id FROM clients WHERE id = $1", [clientIdB]);
    expect(foreign.rows).toHaveLength(0);

    await useOrg(ORG_B);
    const own = await db.query("SELECT id FROM clients WHERE id = $1", [clientIdB]);
    expect(own.rows).toHaveLength(1);
  });

  it("write rejection: WITH CHECK blocks inserting a row into another org", async () => {
    await useOrg(ORG_A);
    await expect(
      db.query(
        `INSERT INTO outbox (event_id, event_type, event_version, organization_id, aggregate_type, aggregate_id, payload)
         VALUES (gen_random_uuid(), 'DemoEvent', 1, $1, 'demo', 'agg-x', '{}'::jsonb)`,
        [ORG_B],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("matching write succeeds: the policy isolates, it does not blanket-deny writes", async () => {
    await useOrg(ORG_A);
    const inserted = await db.query<{ organization_id: string }>(
      `INSERT INTO outbox (event_id, event_type, event_version, organization_id, aggregate_type, aggregate_id, payload)
       VALUES (gen_random_uuid(), 'DemoEvent', 1, $1, 'demo', 'agg-a2', '{}'::jsonb) RETURNING organization_id`,
      [ORG_A],
    );
    expect(inserted.rows[0]!.organization_id).toBe(ORG_A);
    // ...and it is only visible to org A.
    const a = await db.query("SELECT id FROM outbox");
    expect(a.rows).toHaveLength(2); // seed + this insert
    await useOrg(ORG_B);
    const b = await db.query("SELECT id FROM outbox");
    expect(b.rows).toHaveLength(1); // B still sees only its own seed row
  });

  it("cross-org UPDATE touches zero rows (the row is invisible to the wrong org)", async () => {
    await useOrg(ORG_A);
    const res = await db.query("UPDATE outbox SET last_error = 'x' WHERE id = $1", [outboxIdB]);
    expect(res.affectedRows).toBe(0);
  });

  it("fails closed when the org context is unset: zero rows, no leak", async () => {
    await clearOrg();
    const rows = await db.query("SELECT id FROM outbox");
    expect(rows.rows).toHaveLength(0);
    const clients = await db.query("SELECT id FROM clients");
    expect(clients.rows).toHaveLength(0);
  });

  it("fails closed when the context is the empty string: zero rows, not an error", async () => {
    // The nullif(..., '') hardening: a cleared-to-'' GUC maps to NULL instead of
    // raising on ''::uuid. Without nullif this query would throw invalid_text_representation.
    await useOrg("");
    const rows = await db.query("SELECT id FROM outbox");
    expect(rows.rows).toHaveLength(0);
  });
});
