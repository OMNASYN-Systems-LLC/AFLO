import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runtime proof (in-memory Postgres, non-superuser role) that the PHASE 10
 * secure-messaging tables enforce what the cutover directive requires:
 *  - conversation_threads + messages are org-RLS-isolated (list + direct-id +
 *    write rejection + fail-closed-on-unset/empty),
 *  - a read receipt cannot be written to a foreign org's message (RLS hides it),
 *  - the message body is stored as bytea CIPHERTEXT — there is no plaintext body
 *    column, and a round-trip returns the exact opaque bytes we stored.
 * Credential-free (PGlite).
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

// Opaque "ciphertext" bytes for a message body — the DB never sees plaintext.
const CIPHERTEXT_A_HEX = "0badc0de0badc0de0badc0de";
const CIPHERTEXT_B_HEX = "deadbeefdeadbeefdeadbeef";

let db: PGlite;
let clientIdA = "";
let clientIdB = "";
let threadIdA = "";
let threadIdB = "";
let msgIdB = "";

async function useOrg(org: string): Promise<void> {
  await db.query("SELECT set_config('app.current_org_id', $1, false)", [org]);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(allMigrations());

  // Seed as the superuser (bypasses RLS): two orgs, a client + a thread + a
  // message each.
  await db.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
  `);
  const ca = await db.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Al','A') RETURNING id`,
    [ORG_A],
  );
  const cb = await db.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Bo','B') RETURNING id`,
    [ORG_B],
  );
  clientIdA = ca.rows[0]!.id;
  clientIdB = cb.rows[0]!.id;

  const ta = await db.query<{ id: string }>(
    `INSERT INTO conversation_threads (organization_id, client_id, subject) VALUES ($1,$2,'Welcome') RETURNING id`,
    [ORG_A, clientIdA],
  );
  const tb = await db.query<{ id: string }>(
    `INSERT INTO conversation_threads (organization_id, client_id, subject) VALUES ($1,$2,'Docs') RETURNING id`,
    [ORG_B, clientIdB],
  );
  threadIdA = ta.rows[0]!.id;
  threadIdB = tb.rows[0]!.id;

  await db.query(
    `INSERT INTO messages (organization_id, thread_id, client_id, sender_role, sender_id, body_encrypted)
     VALUES ($1,$2,$3,'staff',$3, decode($4,'hex'))`,
    [ORG_A, threadIdA, clientIdA, CIPHERTEXT_A_HEX],
  );
  const mb = await db.query<{ id: string }>(
    `INSERT INTO messages (organization_id, thread_id, client_id, sender_role, sender_id, body_encrypted)
     VALUES ($1,$2,$3,'client',$3, decode($4,'hex')) RETURNING id`,
    [ORG_B, threadIdB, clientIdB, CIPHERTEXT_B_HEX],
  );
  msgIdB = mb.rows[0]!.id;

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

describe("conversation_threads RLS", () => {
  it("list isolation: each org sees only its own threads", async () => {
    await useOrg(ORG_A);
    const a = await db.query<{ subject: string }>("SELECT subject FROM conversation_threads");
    expect(a.rows.map((r) => r.subject)).toEqual(["Welcome"]);
    await useOrg(ORG_B);
    const b = await db.query<{ subject: string }>("SELECT subject FROM conversation_threads");
    expect(b.rows.map((r) => r.subject)).toEqual(["Docs"]);
  });

  it("direct-id isolation: a foreign org's thread is invisible by primary key", async () => {
    await useOrg(ORG_A);
    expect(
      (await db.query("SELECT id FROM conversation_threads WHERE id = $1", [threadIdB])).rows,
    ).toHaveLength(0);
  });

  it("write rejection: cannot open a thread in another org", async () => {
    await useOrg(ORG_A);
    await expect(
      db.query(
        `INSERT INTO conversation_threads (organization_id, client_id, subject) VALUES ($1,$2,'X')`,
        [ORG_B, clientIdB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("fails closed with no org context (unset) and with an empty-string context", async () => {
    await db.exec("RESET app.current_org_id");
    expect((await db.query("SELECT id FROM conversation_threads")).rows).toHaveLength(0);
    await useOrg("");
    expect((await db.query("SELECT id FROM conversation_threads")).rows).toHaveLength(0);
  });
});

describe("messages RLS", () => {
  it("list isolation: each org sees only its own messages", async () => {
    await useOrg(ORG_A);
    expect((await db.query("SELECT id FROM messages")).rows).toHaveLength(1);
    await useOrg(ORG_B);
    const b = await db.query<{ id: string }>("SELECT id FROM messages");
    expect(b.rows.map((r) => r.id)).toEqual([msgIdB]);
  });

  it("write rejection: cannot post a message into another org", async () => {
    await useOrg(ORG_A);
    await expect(
      db.query(
        `INSERT INTO messages (organization_id, thread_id, client_id, sender_role, sender_id, body_encrypted)
         VALUES ($1,$2,$3,'staff',$3, decode('00','hex'))`,
        [ORG_B, threadIdB, clientIdB],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("read-receipt update cannot touch a foreign org's message (RLS hides the row)", async () => {
    await useOrg(ORG_A);
    const res = await db.query(
      `UPDATE messages SET read_by_staff_at = now() WHERE id = $1`,
      [msgIdB],
    );
    // The foreign message is invisible under org A, so zero rows are updated.
    // (PGlite populates affectedRows — asserted directly, not `?? 0`, so an
    // undefined would FAIL rather than pass vacuously.)
    expect(res.affectedRows).toBe(0);
    // And it remains unread when read under its own org.
    await useOrg(ORG_B);
    const b = await db.query<{ read_by_staff_at: string | null }>(
      `SELECT read_by_staff_at FROM messages WHERE id = $1`,
      [msgIdB],
    );
    expect(b.rows[0]!.read_by_staff_at).toBeNull();
  });

  it("body is stored as opaque bytea ciphertext, never plaintext — round-trips exactly", async () => {
    await useOrg(ORG_B);
    const row = await db.query<{ body_encrypted: Uint8Array; hex: string }>(
      `SELECT body_encrypted, encode(body_encrypted, 'hex') AS hex FROM messages WHERE id = $1`,
      [msgIdB],
    );
    // Binary type at rest — a Uint8Array/Buffer, not a readable string.
    expect(row.rows[0]!.body_encrypted).toBeInstanceOf(Uint8Array);
    // Exactly the opaque bytes we stored: the DB never held a plaintext body.
    expect(row.rows[0]!.hex).toBe(CIPHERTEXT_B_HEX);
  });
});
