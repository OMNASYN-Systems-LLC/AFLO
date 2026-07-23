import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { DrizzleAuditEventRepository } from "../src/repositories/audit-events";
import { MESSAGING_DENIAL_AUDIT_ACTION } from "../src/services/authorized-messaging";

/**
 * Workstream B9 (ADR-0044) — the append-only audit-event repository over the
 * existing `audit_events` table, proven credential-free on PGlite under a
 * NON-superuser role so RLS (migration 0003 `org_isolation`) is real:
 * org-scoped writes/reads, tenant isolation on the audit trail itself,
 * ids/codes-only payload discipline, and the null-org sensitive-denial path
 * routing to the structured secondary channel (platform plane, ADR-0025).
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
const T0 = new Date("2026-07-23T12:00:00.000Z");
const T1 = new Date("2026-07-23T12:05:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let memberA = "";

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}','Org A','org-a'), ('${ORG_B}','Org B','org-b');
  `);
  const u = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('a@u.co','A') RETURNING id`,
  );
  const m = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'staff') RETURNING id`,
    [ORG_A, u.rows[0]!.id],
  );
  memberA = m.rows[0]!.id;

  // Non-superuser role so RLS is actually enforced (the proven test pattern).
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

describe("DrizzleAuditEventRepository — append + org-scoped read", () => {
  it("records an event under its org and reads it back (ids/codes only)", async () => {
    const repo = new DrizzleAuditEventRepository(db);
    await repo.record({
      organizationId: ORG_A,
      actorMemberId: memberA,
      action: "messaging.access_denied",
      targetType: "conversation_thread",
      targetId: "thread-1",
      detail: JSON.stringify({ engineReason: "not_owner", permission: "message.read" }),
      reasonCode: "wrong_client_access",
      occurredAt: T0,
    });
    const rows = await repo.listForOrganization(ORG_A);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      organizationId: ORG_A,
      actorMemberId: memberA,
      action: "messaging.access_denied",
      targetType: "conversation_thread",
      targetId: "thread-1",
      reasonCode: "wrong_client_access",
      ruleVersion: null,
      occurredAtIso: T0.toISOString(),
    });
  });

  it("RLS: another org cannot read the audit trail; no org context reads nothing", async () => {
    const repo = new DrizzleAuditEventRepository(db);
    expect(await repo.listForOrganization(ORG_B)).toEqual([]);
    // Fail-closed floor: with NO org context set, the table yields zero rows.
    const bare = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM audit_events`);
    expect(bare.rows[0]!.n).toBe(0);
  });

  it("a cross-org write is rejected by RLS WITH CHECK (cannot forge another tenant's trail)", async () => {
    const repo = new DrizzleAuditEventRepository(db);
    // The repository scopes the transaction to the event's OWN org, so the only
    // forgery shape left is a raw write under a mismatched context — RLS rejects it.
    await expect(
      pg.transaction(async (tx) => {
        await tx.query(`SELECT set_config('app.current_org_id', '${ORG_A}', true)`);
        await tx.query(
          `INSERT INTO audit_events (organization_id, action, target_type, target_id) VALUES ($1,'x','y','z')`,
          [ORG_B],
        );
      }),
    ).rejects.toThrow(/row-level security|violates/i);
    expect(await repo.listForOrganization(ORG_B)).toEqual([]);
  });
});

describe("DrizzleAuditEventRepository — MessagingDenialAuditSink", () => {
  it("persists an org-scoped sensitive denial with its DISTINCT internal reason", async () => {
    const repo = new DrizzleAuditEventRepository(db);
    await repo.recordSensitiveDenial({
      organizationId: ORG_A,
      afloUserId: "user-1",
      actorRole: "client",
      actorMembershipId: null,
      actorClientId: "client-1",
      reason: "wrong_client_access",
      engineReason: "not_owner",
      permission: "message.read",
      target: { type: "conversation_thread", id: "thread-2" },
      occurredAt: T1,
    });
    const rows = await repo.listForOrganization(ORG_A);
    const row = rows.find((r) => r.targetId === "thread-2");
    expect(row).toMatchObject({
      action: MESSAGING_DENIAL_AUDIT_ACTION,
      reasonCode: "wrong_client_access",
      actorMemberId: null,
      targetType: "conversation_thread",
    });
    expect(JSON.parse(row!.detail!)).toEqual({
      engineReason: "not_owner",
      permission: "message.read",
      afloUserId: "user-1",
      actorRole: "client",
      actorClientId: "client-1",
    });
  });

  it("a NULL-org denial routes to the structured secondary channel — no tenant row anywhere", async () => {
    const lines: string[] = [];
    const repo = new DrizzleAuditEventRepository(db, (line) => lines.push(line));
    await repo.recordSensitiveDenial({
      organizationId: null,
      afloUserId: "user-pa",
      actorRole: "platform_admin",
      actorMembershipId: null,
      actorClientId: null,
      reason: "platform_admin_cross_tenant_access",
      engineReason: "no_active_membership",
      permission: "message.read",
      target: { type: "conversation_thread", id: "thread-3" },
      occurredAt: T1,
    });
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]!)).toMatchObject({
      action: MESSAGING_DENIAL_AUDIT_ACTION,
      reason: "platform_admin_cross_tenant_access",
      afloUserId: "user-pa",
      targetId: "thread-3",
    });
    // No row landed in ANY org (superuser count across the whole table).
    await pg.exec("RESET ROLE");
    try {
      const all = await pg.query<{ n: number }>(
        `SELECT count(*)::int AS n FROM audit_events WHERE target_id = 'thread-3'`,
      );
      expect(all.rows[0]!.n).toBe(0);
    } finally {
      await pg.exec("SET ROLE app_user");
    }
  });
});
