import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permissionsForRole, type Role, type SessionContext, type SessionContextProvider } from "@aflo/auth";
import { createAesGcmFieldCipher, generateFieldEncryptionKey } from "@aflo/security";

import { DrizzleAuditEventRepository } from "../src/repositories/audit-events";
import { DrizzleMessagingRepository } from "../src/repositories/messaging";
import {
  AuthorizedMessagingService,
  MESSAGING_DENIAL_AUDIT_ACTION,
} from "../src/services/authorized-messaging";
import {
  handleCreateThread,
  handleGetThread,
  handleListThreads,
  handleMarkThreadRead,
  handlePostMessage,
  handleSetThreadStatus,
  isMessagingRouteConfigured,
  messagingCipherFromEnv,
  type MessagingRouteDeps,
} from "../src/services/messaging-routes";

/**
 * Workstream B9 (ADR-0044) — the messaging route services, proven
 * credential-free: stub session providers + the REAL repositories (messaging +
 * audit) on in-memory Postgres under a non-superuser role so RLS is real.
 * The contracts under test:
 *   - the 503 config predicate + cipher-from-env (the routes' fail-closed gate),
 *   - 401 unauthenticated / 400 stable validation codes,
 *   - THE ANTI-ORACLE RULE: a sensitive denial is DEEP-EQUAL to a genuinely
 *     missing thread on every route (404 `not_found`), while
 *   - the INTERNAL audit row preserves the distinct denial reason (founder
 *     decision 4), is org-scoped (RLS), carries no message content, and
 *   - an audit-write failure still denies (never a success).
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
const NOW = new Date("2026-07-23T12:00:00.000Z");
const SECRET_BODY = "SENSITIVE-PLAINTEXT: my credit report details";

let pg: PGlite;
let db: PgliteDatabase;
let auditRepo: DrizzleAuditEventRepository;
let service: AuthorizedMessagingService;
let clientA1 = "";
let clientA2 = "";
let clientB1 = "";
let staffMemberId = "";
let threadA1 = ""; // client A1's thread (org A)
let threadA2 = ""; // client A2's thread (org A)
let threadB1 = ""; // org B's thread (foreign)

function providerOf(ctx: SessionContext | null): SessionContextProvider {
  return { resolve: async () => ctx };
}

function ctxFor(opts: {
  afloUserId?: string;
  role: Role;
  organizationId?: string | null;
  membershipId?: string | null;
  linkedClientId?: string | null;
}): SessionContext {
  return {
    sessionId: "sess-test",
    clerkUserId: "ck_test",
    afloUserId: opts.afloUserId ?? randomUUID(),
    role: opts.role,
    permissions: permissionsForRole(opts.role),
    accountStatus: "active",
    activeOrganizationId: opts.organizationId ?? null,
    activeMembershipId: opts.membershipId ?? null,
    membershipStatus: opts.role === "platform_admin" ? "none" : "active",
    linkedClientId: opts.linkedClientId ?? null,
    assignedClientIds: null,
  };
}

function depsFor(ctx: SessionContext | null): MessagingRouteDeps {
  return { sessionProvider: providerOf(ctx), messaging: service, now: () => NOW };
}

const staffCtx = () =>
  ctxFor({ role: "staff_advisor", organizationId: ORG_A, membershipId: staffMemberId });
const clientA1Ctx = () => ctxFor({ role: "client", organizationId: ORG_A, linkedClientId: clientA1 });

async function auditRowsA() {
  return auditRepo.listForOrganization(ORG_A);
}

/** Raw-SQL assertions bypass RLS deliberately (the repos run as `app_user`). */
async function asSuperuser<T>(fn: () => Promise<T>): Promise<T> {
  await pg.exec("RESET ROLE");
  try {
    return await fn();
  } finally {
    await pg.exec("SET ROLE app_user");
  }
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}','Org A','org-a'), ('${ORG_B}','Org B','org-b');
  `);
  const ca = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES
       ($1,'stage-new','Al','A'), ($1,'stage-new','Ada','A') RETURNING id`,
    [ORG_A],
  );
  clientA1 = ca.rows[0]!.id;
  clientA2 = ca.rows[1]!.id;
  const cb = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Bo','B') RETURNING id`,
    [ORG_B],
  );
  clientB1 = cb.rows[0]!.id;
  const u = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('staff@u.co','Staff') RETURNING id`,
  );
  const m = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'staff') RETURNING id`,
    [ORG_A, u.rows[0]!.id],
  );
  staffMemberId = m.rows[0]!.id;

  // Non-superuser role so RLS is actually enforced (the proven test pattern).
  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);

  const cipher = createAesGcmFieldCipher(generateFieldEncryptionKey());
  const messagingRepo = new DrizzleMessagingRepository(db, cipher);
  auditRepo = new DrizzleAuditEventRepository(db);
  service = new AuthorizedMessagingService(messagingRepo, auditRepo);

  threadA1 = (await messagingRepo.createThread(ORG_A, { clientId: clientA1, subject: "Welcome A1" }, NOW)).id;
  threadA2 = (await messagingRepo.createThread(ORG_A, { clientId: clientA2, subject: "Welcome A2" }, NOW)).id;
  threadB1 = (await messagingRepo.createThread(ORG_B, { clientId: clientB1, subject: "Welcome B1" }, NOW)).id;
  await messagingRepo.postMessage(
    ORG_A,
    { threadId: threadA2, senderRole: "staff", senderId: staffMemberId, body: SECRET_BODY },
    NOW,
  );
});

afterAll(async () => {
  await pg?.close();
});

describe("isMessagingRouteConfigured + messagingCipherFromEnv — the routes' 503 gate", () => {
  const KEY = generateFieldEncryptionKey().toString("base64");
  const FULL = {
    AUTH_MODE: "clerk",
    REPOSITORY_MODE: "postgres",
    DATABASE_URL: "postgres://app@host/db",
    AUTH_RESOLVER_DATABASE_URL: "postgres://resolver@host/db",
    FIELD_ENCRYPTION_KEY: KEY,
  };

  it("true only when clerk + postgres + both URLs + the field key are ALL present", () => {
    expect(isMessagingRouteConfigured(FULL)).toBe(true);
    for (const missing of Object.keys(FULL)) {
      const env: Record<string, string | undefined> = { ...FULL };
      delete env[missing];
      expect(isMessagingRouteConfigured(env)).toBe(false);
    }
    expect(isMessagingRouteConfigured({ ...FULL, AUTH_MODE: "demo" })).toBe(false);
    expect(isMessagingRouteConfigured({ ...FULL, REPOSITORY_MODE: "mock" })).toBe(false);
    expect(isMessagingRouteConfigured({})).toBe(false);
  });

  it("cipher: null on a missing or malformed key (fail closed), a working cipher on a valid one", () => {
    expect(messagingCipherFromEnv({})).toBeNull();
    expect(messagingCipherFromEnv({ FIELD_ENCRYPTION_KEY: "" })).toBeNull();
    expect(messagingCipherFromEnv({ FIELD_ENCRYPTION_KEY: "too-short" })).toBeNull();
    const cipher = messagingCipherFromEnv({ FIELD_ENCRYPTION_KEY: KEY });
    expect(cipher).not.toBeNull();
    expect(cipher!.decrypt(cipher!.encrypt("round-trip"))).toBe("round-trip");
  });
});

describe("messaging route services — session + validation gates", () => {
  it("401 unauthenticated on every handler when no session resolves", async () => {
    const deps = depsFor(null);
    const expected = { status: 401, body: { ok: false, error: "unauthenticated" } };
    expect(await handleCreateThread(deps, { clientId: clientA1, subject: "x" })).toEqual(expected);
    expect(await handleListThreads(deps, { clientId: clientA1 })).toEqual(expected);
    expect(await handleGetThread(deps, { threadId: threadA1 })).toEqual(expected);
    expect(await handlePostMessage(deps, { threadId: threadA1 }, { body: "x" })).toEqual(expected);
    expect(await handleMarkThreadRead(deps, { threadId: threadA1 })).toEqual(expected);
    expect(await handleSetThreadStatus(deps, { threadId: threadA1 }, { action: "close" })).toEqual(expected);
  });

  it("400 stable codes for malformed input (shape errors, not existence probes)", async () => {
    const deps = depsFor(staffCtx());
    expect(await handleCreateThread(deps, { subject: "x" })).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_client_id" },
    });
    expect(await handleCreateThread(deps, { clientId: clientA1, subject: "  " })).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_subject" },
    });
    expect(await handleListThreads(deps, {})).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_client_id" },
    });
    expect(await handleGetThread(deps, { threadId: "" })).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_thread_id" },
    });
    expect(await handlePostMessage(deps, { threadId: threadA1 }, {})).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_body" },
    });
    expect(await handleSetThreadStatus(deps, { threadId: threadA1 }, { action: "archive" })).toEqual({
      status: 400,
      body: { ok: false, error: "invalid_action" },
    });
  });

  it("post-authorization kernel rejections keep distinct stable codes (no oracle value)", async () => {
    const deps = depsFor(staffCtx());
    expect(await handlePostMessage(deps, { threadId: threadA1 }, { body: "   " })).toEqual({
      status: 400,
      body: { ok: false, error: "MSG_EMPTY_BODY" },
    });
    expect(await handleSetThreadStatus(deps, { threadId: threadA1 }, { action: "reopen" })).toEqual({
      status: 409,
      body: { ok: false, error: "MSG_ILLEGAL_THREAD_TRANSITION" },
    });
  });
});

describe("messaging route services — happy paths (PGlite end to end)", () => {
  it("staff open a thread, post, read, close, reopen; client reads their own", async () => {
    const staff = depsFor(staffCtx());
    const created = await handleCreateThread(staff, { clientId: clientA1, subject: "Quarterly check-in" });
    expect(created.status).toBe(201);
    if (created.status !== 201) return;
    expect(created.body.thread).toMatchObject({ clientId: clientA1, status: "open" });

    const posted = await handlePostMessage(staff, { threadId: created.body.thread.id }, { body: "Hello A1" });
    expect(posted.status).toBe(201);
    if (posted.status !== 201) return;
    // Sender DERIVED from the session — staff membership, never request input.
    expect(posted.body.message).toMatchObject({ senderRole: "staff", senderId: staffMemberId, body: "Hello A1" });

    const client = depsFor(clientA1Ctx());
    const got = await handleGetThread(client, { threadId: created.body.thread.id });
    expect(got.status).toBe(200);
    if (got.status !== 200) return;
    expect(got.body.messages.map((m) => m.body)).toEqual(["Hello A1"]);

    const read = await handleMarkThreadRead(client, { threadId: created.body.thread.id });
    expect(read).toEqual({ status: 200, body: { ok: true, updated: 1 } });

    const listed = await handleListThreads(client, { clientId: clientA1 });
    expect(listed.status).toBe(200);
    if (listed.status !== 200) return;
    expect(listed.body.threads.map((t) => t.id)).toContain(created.body.thread.id);

    expect(await handleSetThreadStatus(staff, { threadId: created.body.thread.id }, { action: "close" })).toEqual({
      status: 200,
      body: { ok: true, status: "closed" },
    });
    expect(await handleSetThreadStatus(staff, { threadId: created.body.thread.id }, { action: "reopen" })).toEqual({
      status: 200,
      body: { ok: true, status: "open" },
    });
  });
});

describe("THE ANTI-ORACLE RULE — a denial is deep-equal to a genuinely missing thread", () => {
  const UNKNOWN = "00000000-0000-0000-0000-00000000dead";

  it("getThread: unknown id ≡ foreign-org id ≡ denied same-org id ≡ malformed id", async () => {
    const notFoundResult = await handleGetThread(depsFor(staffCtx()), { threadId: UNKNOWN });
    expect(notFoundResult).toEqual({ status: 404, body: { ok: false, error: "not_found" } });

    const foreign = await handleGetThread(depsFor(staffCtx()), { threadId: threadB1 });
    const denied = await handleGetThread(depsFor(clientA1Ctx()), { threadId: threadA2 });
    const malformed = await handleGetThread(depsFor(staffCtx()), { threadId: "not-a-uuid" });
    expect(foreign).toEqual(notFoundResult);
    expect(denied).toEqual(notFoundResult); // audited internally, invisible externally
    expect(malformed).toEqual(notFoundResult);
  });

  it("postMessage: unknown id ≡ denied same-org id (writes included — ADR-0036)", async () => {
    const notFoundResult = await handlePostMessage(depsFor(staffCtx()), { threadId: UNKNOWN }, { body: "x" });
    const denied = await handlePostMessage(depsFor(clientA1Ctx()), { threadId: threadA2 }, { body: "x" });
    expect(notFoundResult).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
    expect(denied).toEqual(notFoundResult);
  });

  it("markThreadRead: unknown id ≡ denied same-org id", async () => {
    const notFoundResult = await handleMarkThreadRead(depsFor(staffCtx()), { threadId: UNKNOWN });
    const denied = await handleMarkThreadRead(depsFor(clientA1Ctx()), { threadId: threadA2 });
    expect(notFoundResult).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
    expect(denied).toEqual(notFoundResult);
  });

  it("setThreadStatus: unknown id ≡ client-denied close (permission_denied is invisible too)", async () => {
    const notFoundResult = await handleSetThreadStatus(depsFor(staffCtx()), { threadId: UNKNOWN }, { action: "close" });
    const denied = await handleSetThreadStatus(depsFor(clientA1Ctx()), { threadId: threadA1 }, { action: "close" });
    expect(notFoundResult).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
    expect(denied).toEqual(notFoundResult);
  });

  it("createThread/listThreads: an unknown/foreign client ≡ a denied one", async () => {
    const unknownClient = await handleCreateThread(depsFor(staffCtx()), {
      clientId: UNKNOWN,
      subject: "x",
    });
    const foreignClient = await handleCreateThread(depsFor(staffCtx()), {
      clientId: clientB1,
      subject: "x",
    });
    const deniedCreate = await handleCreateThread(depsFor(clientA1Ctx()), {
      clientId: clientA2,
      subject: "x",
    });
    expect(unknownClient).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
    expect(foreignClient).toEqual(unknownClient);
    expect(deniedCreate).toEqual(unknownClient);

    const deniedList = await handleListThreads(depsFor(clientA1Ctx()), { clientId: clientA2 });
    expect(deniedList).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
  });
});

describe("sensitive-denial audit rows (founder decision 4) — internal, org-scoped, content-free", () => {
  it("a denied route call writes exactly ONE org-scoped row with the DISTINCT internal reason", async () => {
    const before = (await auditRowsA()).length;
    await handleGetThread(depsFor(clientA1Ctx()), { threadId: threadA2 });
    const rows = await auditRowsA();
    expect(rows.length).toBe(before + 1);
    const row = rows.at(-1)!;
    expect(row).toMatchObject({
      organizationId: ORG_A,
      action: MESSAGING_DENIAL_AUDIT_ACTION,
      reasonCode: "wrong_client_access",
      targetType: "conversation_thread",
      targetId: threadA2,
      actorMemberId: null,
    });
    expect(JSON.parse(row.detail!)).toMatchObject({
      engineReason: "not_owner",
      permission: "message.read",
      actorRole: "client",
      actorClientId: clientA1,
    });
  });

  it("each denial category lands with its own reason code (client-target + close-authority)", async () => {
    const before = (await auditRowsA()).length;
    await handleCreateThread(depsFor(clientA1Ctx()), { clientId: clientA2, subject: "x" });
    await handleSetThreadStatus(depsFor(clientA1Ctx()), { threadId: threadA1 }, { action: "close" });
    const rows = await auditRowsA();
    expect(rows.slice(before).map((r) => r.reasonCode)).toEqual([
      "ownership_mismatch",
      "publication_without_authority",
    ]);
  });

  it("audit rows NEVER contain message content, subjects, or bodies (full-table dump)", async () => {
    const dump = await asSuperuser(() =>
      pg.query<Record<string, unknown>>(`SELECT * FROM audit_events`),
    );
    const serialized = JSON.stringify(dump.rows);
    expect(dump.rows.length).toBeGreaterThan(0);
    expect(serialized).not.toContain(SECRET_BODY);
    expect(serialized).not.toContain("Welcome A1");
    expect(serialized).not.toContain("Welcome A2");
    expect(serialized).not.toContain("Hello A1");
  });

  it("RLS: org B reads NONE of org A's denial rows", async () => {
    expect((await auditRepo.listForOrganization(ORG_B)).length).toBe(0);
  });

  it("happy paths write NO audit rows", async () => {
    const before = (await auditRowsA()).length;
    await handleGetThread(depsFor(staffCtx()), { threadId: threadA1 });
    await handleListThreads(depsFor(clientA1Ctx()), { clientId: clientA1 });
    expect((await auditRowsA()).length).toBe(before);
  });

  it("an audit-write failure STILL denies with the uniform 404 (never a success, never a leak)", async () => {
    const failures: unknown[] = [];
    const failing = new AuthorizedMessagingService(
      new DrizzleMessagingRepository(db, createAesGcmFieldCipher(generateFieldEncryptionKey())),
      {
        recordSensitiveDenial: async () => {
          throw new Error("audit store down");
        },
      },
      (err) => failures.push(err),
    );
    const deps: MessagingRouteDeps = {
      sessionProvider: providerOf(clientA1Ctx()),
      messaging: failing,
      now: () => NOW,
    };
    const denied = await handleGetThread(deps, { threadId: threadA2 });
    expect(denied).toEqual({ status: 404, body: { ok: false, error: "not_found" } });
    expect(failures).toHaveLength(1);
  });
});
