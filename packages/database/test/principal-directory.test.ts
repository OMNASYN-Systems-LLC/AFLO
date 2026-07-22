import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { buildSessionContext } from "@aflo/auth";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzlePrincipalDirectory } from "../src/repositories/principal-directory";

/**
 * Workstream B5 (ADR-0037) — the Drizzle PrincipalDirectory proven on
 * in-memory Postgres UNDER the resolver role with the migration-0008 grants:
 * identity mapping → users row (incl. the REQUIRED revocation-cutoff mapping)
 * → active membership / active client link, all pre-org-context, all
 * fail-closed. The final tests thread the records through buildSessionContext
 * to prove the directory feeds the adapter exactly what it needs.
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function sql(files: string[]): string {
  return files
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replaceAll("--> statement-breakpoint", "");
}

const ORG = "00000000-0000-0000-0000-0000000000aa";
const CUTOFF = new Date("2026-07-20T11:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let directory: DrizzlePrincipalDirectory;
const u: Record<string, string> = {};
let clientId: string;
let membershipId: string;

beforeAll(async () => {
  pg = await PGlite.create();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  // Baseline schema first, then role provisioning, then the grant migrations —
  // mirroring the deploy order (0007 resolver boundary, 0008 principal grants).
  await pg.exec(sql(files.filter((f) => f < "0007")));
  await pg.exec(`
    CREATE ROLE aflo_auth_resolver BYPASSRLS NOLOGIN;
    GRANT USAGE ON SCHEMA public TO aflo_auth_resolver;
  `);
  await pg.exec(sql(files.filter((f) => f.startsWith("0007") || f.startsWith("0008"))));

  await pg.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${ORG}', 'Org', 'org');`);
  for (const key of ["staff", "client", "admin", "disabled", "revoked", "none", "dangling"]) {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
      [`${key}@x.co`, key],
    );
    u[key] = r.rows[0]!.id;
    await pg.exec(
      `INSERT INTO identity_provider_accounts (provider, provider_user_id, aflo_user_id) VALUES ('clerk', 'ck_${key}', '${u[key]}')`,
    );
  }
  await pg.exec(`UPDATE users SET is_platform_admin = true WHERE id = '${u.admin}'`);
  await pg.exec(`UPDATE users SET is_active = false WHERE id = '${u.disabled}'`);
  await pg.exec(
    `UPDATE users SET sessions_invalidated_before = '${CUTOFF.toISOString()}' WHERE id = '${u.revoked}'`,
  );
  // A truly DANGLING mapping (pointing at a missing users row) is unrepresentable
  // here — the FK's ON DELETE CASCADE removes the mapping with the user — so
  // deleting this user proves the stranger path below; the directory's in-code
  // missing-user guard remains defense in depth.
  await pg.exec(`DELETE FROM users WHERE id = '${u.dangling}'`);

  const m = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ('${ORG}', '${u.staff}', 'staff') RETURNING id`,
  );
  membershipId = m.rows[0]!.id;
  const c = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ('${ORG}','stage-new','Cli','Ent') RETURNING id`,
  );
  clientId = c.rows[0]!.id;
  await pg.exec(
    `INSERT INTO client_user_links (organization_id, client_id, user_id, status) VALUES ('${ORG}', '${clientId}', '${u.client}', 'active')`,
  );

  db = drizzle(pg);
  await pg.exec("SET ROLE aflo_auth_resolver"); // production connection role
  directory = new DrizzlePrincipalDirectory(db);
});

afterAll(async () => {
  await pg?.close();
});

describe("DrizzlePrincipalDirectory — resolver-role principal resolution", () => {
  it("resolves a staff member: identity + active membership, no client link", async () => {
    const records = await directory.loadByProviderUser("clerk", "ck_staff");
    expect(records).toMatchObject({
      identity: {
        afloUserId: u.staff,
        clerkUserId: "ck_staff",
        accountStatus: "active",
        isPlatformAdmin: false,
        sessionsInvalidatedBeforeIso: null,
      },
      membership: { membershipId, organizationId: ORG, memberRole: "staff", status: "active" },
      clientLink: null,
      assignedClientIds: null,
    });
  });

  it("resolves a client through their ACTIVE link", async () => {
    const records = await directory.loadByProviderUser("clerk", "ck_client");
    expect(records?.membership).toBeNull();
    expect(records?.clientLink).toEqual({ clientId, organizationId: ORG });
  });

  it("maps the platform-admin flag and the disabled account status", async () => {
    expect((await directory.loadByProviderUser("clerk", "ck_admin"))?.identity.isPlatformAdmin).toBe(true);
    expect((await directory.loadByProviderUser("clerk", "ck_disabled"))?.identity.accountStatus).toBe("disabled");
  });

  it("maps the REQUIRED revocation cutoff (never silently absent)", async () => {
    const records = await directory.loadByProviderUser("clerk", "ck_revoked");
    expect(records?.identity.sessionsInvalidatedBeforeIso).toBe(CUTOFF.toISOString());
  });

  it("an unmapped provider identity resolves null (authenticated stranger)", async () => {
    expect(await directory.loadByProviderUser("clerk", "ck_unknown")).toBeNull();
    // A deleted user takes its mapping with it (FK cascade) → stranger again.
    expect(await directory.loadByProviderUser("clerk", "ck_dangling")).toBeNull();
  });

  it("a revoked client link does not resolve (fail-closed)", async () => {
    await pg.exec("RESET ROLE");
    await pg.exec(`UPDATE client_user_links SET status = 'revoked' WHERE user_id = '${u.client}'`);
    await pg.exec("SET ROLE aflo_auth_resolver");
    expect((await directory.loadByProviderUser("clerk", "ck_client"))?.clientLink).toBeNull();
    await pg.exec("RESET ROLE");
    await pg.exec(`UPDATE client_user_links SET status = 'active' WHERE user_id = '${u.client}'`);
    await pg.exec("SET ROLE aflo_auth_resolver");
  });

  it("a deactivated membership does not resolve (fail-closed under-grant)", async () => {
    await pg.exec("RESET ROLE");
    await pg.exec(`UPDATE organization_members SET is_active = false WHERE id = '${membershipId}'`);
    await pg.exec("SET ROLE aflo_auth_resolver");
    expect((await directory.loadByProviderUser("clerk", "ck_staff"))?.membership).toBeNull();
    await pg.exec("RESET ROLE");
    await pg.exec(`UPDATE organization_members SET is_active = true WHERE id = '${membershipId}'`);
    await pg.exec("SET ROLE aflo_auth_resolver");
  });

  it("feeds buildSessionContext end-to-end: staff resolves, revoked-cutoff session does not", async () => {
    const staff = await directory.loadByProviderUser("clerk", "ck_staff");
    const ctx = buildSessionContext({
      sessionId: "sess-1",
      identity: staff!.identity,
      membership: staff!.membership,
      clientLink: staff!.clientLink,
      assignedClientIds: staff!.assignedClientIds,
      sessionIssuedAtIso: "2026-07-22T12:00:00.000Z",
    });
    expect(ctx).toMatchObject({ role: "staff_advisor", activeOrganizationId: ORG });

    const revoked = await directory.loadByProviderUser("clerk", "ck_revoked");
    const dead = buildSessionContext({
      sessionId: "sess-2",
      identity: revoked!.identity,
      membership: null,
      clientLink: null,
      sessionIssuedAtIso: "2026-07-20T10:00:00.000Z", // issued BEFORE the cutoff
    });
    expect(dead).toBeNull();
  });
});
