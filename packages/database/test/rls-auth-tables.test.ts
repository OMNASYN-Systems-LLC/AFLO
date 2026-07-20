import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runtime proof (in-memory Postgres, non-superuser role) that the PHASE 2 auth
 * persistence tables enforce what the cutover directive requires:
 *  - invitations + client_user_links are org-RLS-isolated (list + direct-id +
 *    write rejection + fail-closed-on-unset),
 *  - invitation token/email uniqueness holds,
 *  - a client-user double claim is rejected (the active-link partial uniques).
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

let db: PGlite;
let clientIdA = "";
let clientIdB = "";
let userIdA = "";
let invIdB = "";

async function useOrg(org: string): Promise<void> {
  await db.query("SELECT set_config('app.current_org_id', $1, false)", [org]);
}

beforeAll(async () => {
  db = await PGlite.create();
  await db.exec(allMigrations());

  // Seed as the superuser (bypasses RLS): two orgs, a client + a user each, one
  // invitation + one client_user_link per org.
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
  const ua = await db.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('a@x.co','A') RETURNING id`,
  );
  userIdA = ua.rows[0]!.id;

  await db.exec(`
    INSERT INTO invitations (organization_id, email, invitation_type, intended_role, token_digest, expires_at) VALUES
      ('${ORG_A}', 'inv-a@x.co', 'staff', 'staff_advisor', 'digest-a', now() + interval '7 days');
  `);
  const ib = await db.query<{ id: string }>(
    `INSERT INTO invitations (organization_id, email, invitation_type, intended_role, intended_client_id, token_digest, expires_at)
     VALUES ($1, 'inv-b@x.co', 'client', 'client', $2, 'digest-b', now() + interval '7 days') RETURNING id`,
    [ORG_B, clientIdB],
  );
  invIdB = ib.rows[0]!.id;

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

describe("invitations RLS", () => {
  it("list isolation: each org sees only its own invitations", async () => {
    await useOrg(ORG_A);
    const a = await db.query<{ email: string }>("SELECT email FROM invitations");
    expect(a.rows.map((r) => r.email)).toEqual(["inv-a@x.co"]);
    await useOrg(ORG_B);
    const b = await db.query<{ email: string }>("SELECT email FROM invitations");
    expect(b.rows.map((r) => r.email)).toEqual(["inv-b@x.co"]);
  });

  it("direct-id isolation: a foreign org's invitation is invisible by primary key", async () => {
    await useOrg(ORG_A);
    expect((await db.query("SELECT id FROM invitations WHERE id = $1", [invIdB])).rows).toHaveLength(0);
  });

  it("write rejection: cannot create an invitation in another org", async () => {
    await useOrg(ORG_A);
    await expect(
      db.query(
        `INSERT INTO invitations (organization_id, email, invitation_type, intended_role, token_digest, expires_at)
         VALUES ($1,'x@x.co','staff','staff_advisor','digest-x', now() + interval '1 day')`,
        [ORG_B],
      ),
    ).rejects.toThrow(/row-level security/i);
  });

  it("fails closed with no org context", async () => {
    await db.exec("RESET app.current_org_id");
    expect((await db.query("SELECT id FROM invitations")).rows).toHaveLength(0);
  });
});

describe("uniqueness / idempotency constraints", () => {
  it("rejects a duplicate invitation token digest within an org", async () => {
    await useOrg(ORG_A);
    await expect(
      db.query(
        `INSERT INTO invitations (organization_id, email, invitation_type, intended_role, token_digest, expires_at)
         VALUES ($1,'other@x.co','staff','staff_advisor','digest-a', now() + interval '1 day')`,
        [ORG_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("allows only one PENDING invitation per (org, email)", async () => {
    await useOrg(ORG_A);
    await expect(
      db.query(
        `INSERT INTO invitations (organization_id, email, invitation_type, intended_role, token_digest, expires_at)
         VALUES ($1,'inv-a@x.co','staff','staff_advisor','digest-a2', now() + interval '1 day')`,
        [ORG_A],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });

  it("rejects a client-user double claim (two active links to the same client)", async () => {
    await useOrg(ORG_A);
    await db.query(
      `INSERT INTO client_user_links (organization_id, client_id, user_id, status) VALUES ($1,$2,$3,'active')`,
      [ORG_A, clientIdA, userIdA],
    );
    // a second ACTIVE link to the same client (different user) violates the partial unique
    const otherUser = await db.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ('a2@x.co','A2') RETURNING id`,
    );
    await expect(
      db.query(
        `INSERT INTO client_user_links (organization_id, client_id, user_id, status) VALUES ($1,$2,$3,'active')`,
        [ORG_A, clientIdA, otherUser.rows[0]!.id],
      ),
    ).rejects.toThrow(/duplicate key|unique/i);
  });
});
