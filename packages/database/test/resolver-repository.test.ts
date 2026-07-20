import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DrizzleIdentityAccountRepository,
  DrizzleSessionRevocationRepository,
  DrizzleWebhookEventRepository,
} from "../src/repositories/resolver";

/**
 * Integration proof (in-memory Postgres, under the resolver role) that the
 * resolver-path repositories over the three UN-scoped auth tables:
 *  - map a provider identity → AFLO user, idempotently;
 *  - record webhook receipts idempotently (redelivery → isNew:false) and drive
 *    processed/failed;
 *  - record session revocations and answer isSessionRevoked USER-SCOPED
 *    (all-sessions vs a specific digest, issued-before-cutoff, expiry, and NOT
 *    revoking a different user).
 * Runs as aflo_auth_resolver (the migration-0007 grants), NOT the tenant role.
 * Credential-free (PGlite).
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function sql(files: string[]): string {
  return files
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replaceAll("--> statement-breakpoint", "");
}

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const T_BEFORE = new Date("2026-07-20T10:00:00.000Z");
const T_REVOKE = new Date("2026-07-20T11:00:00.000Z");
const T_AFTER = new Date("2026-07-20T12:00:00.000Z");
const T_CHECK = new Date("2026-07-20T13:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let idRepo: DrizzleIdentityAccountRepository;
let hookRepo: DrizzleWebhookEventRepository;
let revRepo: DrizzleSessionRevocationRepository;
const u: Record<string, string> = {};

beforeAll(async () => {
  pg = await PGlite.create();
  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  await pg.exec(sql(files.filter((f) => f < "0007")));

  await pg.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${ORG_A}', 'Org A', 'org-a');`);
  for (const key of ["idp", "all", "digest", "expired", "a", "b"]) {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
      [`${key}@x.co`, key],
    );
    u[key] = r.rows[0]!.id;
  }

  // Provision the resolver role + baseline, then apply 0007 (grants it access).
  await pg.exec(`
    CREATE ROLE aflo_auth_resolver BYPASSRLS NOLOGIN;
    GRANT USAGE ON SCHEMA public TO aflo_auth_resolver;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aflo_auth_resolver;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aflo_auth_resolver;
  `);
  await pg.exec(sql(files.filter((f) => f.startsWith("0007"))));

  db = drizzle(pg);
  // Every repository op runs as the resolver role (the production connection).
  await pg.exec("SET ROLE aflo_auth_resolver");
  idRepo = new DrizzleIdentityAccountRepository(db);
  hookRepo = new DrizzleWebhookEventRepository(db);
  revRepo = new DrizzleSessionRevocationRepository(db);
});

afterAll(async () => {
  await pg?.close();
});

describe("DrizzleIdentityAccountRepository", () => {
  it("links a provider identity and resolves it back", async () => {
    const linked = await idRepo.link("clerk", "clerk_abc", u.idp!, T_BEFORE);
    expect(linked.afloUserId).toBe(u.idp);
    const found = await idRepo.findByProvider("clerk", "clerk_abc");
    expect(found?.afloUserId).toBe(u.idp);
  });

  it("link is idempotent (same identity → existing mapping, no duplicate)", async () => {
    const again = await idRepo.link("clerk", "clerk_abc", u.idp!, T_AFTER);
    expect(again.afloUserId).toBe(u.idp);
    const count = await pg.query<{ n: number }>(
      `SELECT count(*)::int AS n FROM identity_provider_accounts WHERE provider_user_id = 'clerk_abc'`,
    );
    expect(count.rows[0]!.n).toBe(1);
  });

  it("findByProvider returns null for an unknown identity", async () => {
    expect(await idRepo.findByProvider("clerk", "nope")).toBeNull();
  });
});

describe("DrizzleWebhookEventRepository", () => {
  it("records a receipt (isNew) and treats a redelivery as not-new", async () => {
    const first = await hookRepo.recordReceipt("clerk", "evt_1", "user.created", "d".repeat(64), T_BEFORE);
    expect(first.isNew).toBe(true);
    const redeliver = await hookRepo.recordReceipt("clerk", "evt_1", "user.created", "d".repeat(64), T_AFTER);
    expect(redeliver.isNew).toBe(false);
    expect(redeliver.record.id).toBe(first.record.id);
  });

  it("marks a receipt processed", async () => {
    const rec = await hookRepo.recordReceipt("clerk", "evt_proc", "user.updated", "e".repeat(64), T_BEFORE);
    await hookRepo.markProcessed(rec.record.id, T_AFTER);
    const row = await pg.query<{ status: string; processed_at: string | null }>(
      `SELECT status, processed_at FROM provider_webhook_events WHERE id = $1`,
      [rec.record.id],
    );
    expect(row.rows[0]!.status).toBe("processed");
    expect(row.rows[0]!.processed_at).not.toBeNull();
  });

  it("marks a receipt failed (increments attempts, records the error code)", async () => {
    const rec = await hookRepo.recordReceipt("clerk", "evt_fail", "user.deleted", "f".repeat(64), T_BEFORE);
    await hookRepo.markFailed(rec.record.id, T_AFTER, "SYNC_ERROR");
    const row = await pg.query<{ status: string; attempts: number; last_error_code: string }>(
      `SELECT status, attempts, last_error_code FROM provider_webhook_events WHERE id = $1`,
      [rec.record.id],
    );
    expect(row.rows[0]!.status).toBe("failed");
    expect(row.rows[0]!.attempts).toBe(1);
    expect(row.rows[0]!.last_error_code).toBe("SYNC_ERROR");
  });
});

describe("DrizzleSessionRevocationRepository (user-scoped)", () => {
  it("no revocation → not revoked", async () => {
    expect(await revRepo.isSessionRevoked(u.all!, T_BEFORE, null, T_CHECK)).toBe(false);
  });

  it("revoke-all kills sessions issued before the cutoff, spares later ones", async () => {
    await revRepo.revoke({ userId: u.all!, reasonCode: "disabled" }, T_REVOKE);
    // issued before the revocation → revoked
    expect(await revRepo.isSessionRevoked(u.all!, T_BEFORE, "sess-x", T_CHECK)).toBe(true);
    // issued after the revocation → not revoked
    expect(await revRepo.isSessionRevoked(u.all!, T_AFTER, "sess-x", T_CHECK)).toBe(false);
  });

  it("a digest-specific revocation only targets that session", async () => {
    await revRepo.revoke({ userId: u.digest!, providerSessionIdDigest: "sess-D", reasonCode: "compromised" }, T_REVOKE);
    expect(await revRepo.isSessionRevoked(u.digest!, T_BEFORE, "sess-D", T_CHECK)).toBe(true);
    expect(await revRepo.isSessionRevoked(u.digest!, T_BEFORE, "sess-E", T_CHECK)).toBe(false);
  });

  it("an expired revocation no longer applies", async () => {
    await revRepo.revoke(
      { userId: u.expired!, reasonCode: "temp", expiresAt: new Date("2026-07-20T11:30:00.000Z") },
      T_REVOKE,
    );
    // now (T_CHECK 13:00) is past expiry (11:30) → not revoked
    expect(await revRepo.isSessionRevoked(u.expired!, T_BEFORE, "sess-x", T_CHECK)).toBe(false);
  });

  it("is user-scoped: revoking user A does not revoke user B", async () => {
    await revRepo.revoke({ userId: u.a!, reasonCode: "disabled" }, T_REVOKE);
    expect(await revRepo.isSessionRevoked(u.a!, T_BEFORE, "sess-x", T_CHECK)).toBe(true);
    expect(await revRepo.isSessionRevoked(u.b!, T_BEFORE, "sess-x", T_CHECK)).toBe(false);
  });
});
