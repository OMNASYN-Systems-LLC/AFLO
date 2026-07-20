import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAesGcmFieldCipher, generateFieldEncryptionKey } from "@aflo/security";

import {
  DrizzleMessagingRepository,
  MessageRejectedError,
  MessagingClientNotFoundError,
  NotThreadClientError,
  ThreadNotFoundError,
  ThreadTransitionError,
} from "../src/repositories/messaging";

/**
 * Integration proof (in-memory Postgres, non-superuser role) that the Drizzle
 * messaging repository:
 *  - runs every op through withOrgContext so RLS scopes it to one org,
 *  - stores message bodies ONLY as ciphertext (decrypts on read),
 *  - derives clientId from the thread (no cross-client mis-filing) and rejects a
 *    client posting to a thread that isn't theirs,
 *  - re-validates well-formedness (closed thread / empty body) against the kernel,
 *  - drives read receipts and thread status.
 * Credential-free (PGlite + an ephemeral encryption key).
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
const STAFF_A = "00000000-0000-0000-0000-00000000a111";
const T0 = new Date("2026-07-20T12:00:00.000Z");
const T1 = new Date("2026-07-20T12:05:00.000Z");
const T2 = new Date("2026-07-20T12:10:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let repo: DrizzleMessagingRepository;
let clientA1 = "";
let clientA2 = "";
let clientB1 = "";

/** Read raw rows as the superuser (RLS-bypassing) for at-rest assertions. */
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
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
  `);
  const ca1 = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Al','A') RETURNING id`,
    [ORG_A],
  );
  const ca2 = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Ada','A') RETURNING id`,
    [ORG_A],
  );
  const cb1 = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Bo','B') RETURNING id`,
    [ORG_B],
  );
  clientA1 = ca1.rows[0]!.id;
  clientA2 = ca2.rows[0]!.id;
  clientB1 = cb1.rows[0]!.id;

  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
  repo = new DrizzleMessagingRepository(db, createAesGcmFieldCipher(generateFieldEncryptionKey()));
});

afterAll(async () => {
  await pg?.close();
});

describe("DrizzleMessagingRepository — persistence + encryption + org isolation", () => {
  let threadA = "";

  it("creates a thread and posts a message; body is stored ONLY as ciphertext", async () => {
    const thread = await repo.createThread(ORG_A, { clientId: clientA1, subject: "Welcome" }, T0);
    threadA = thread.id;
    expect(thread.status).toBe("open");
    expect(thread.lastMessageAt).toBeNull();

    const body = "SENSITIVE-BODY: please review my credit report";
    const msg = await repo.postMessage(
      ORG_A,
      { threadId: threadA, senderRole: "staff", senderId: STAFF_A, body },
      T1,
    );
    expect(msg.body).toBe(body);
    expect(msg.clientId).toBe(clientA1); // derived from the thread
    expect(msg.readByStaffAt).toBe(T1.toISOString());
    expect(msg.readByClientAt).toBeNull();

    // At rest, the DB holds opaque ciphertext — never the plaintext.
    const raw = await asSuperuser(() =>
      pg.query<{ hex: string; len: number }>(
        `SELECT encode(body_encrypted,'hex') AS hex, octet_length(body_encrypted) AS len FROM messages WHERE id = $1`,
        [msg.id],
      ),
    );
    const hex = raw.rows[0]!.hex;
    const plaintextHex = Buffer.from(body, "utf8").toString("hex");
    expect(hex).not.toContain(plaintextHex);
    expect(Buffer.from(hex, "hex").toString("latin1")).not.toContain(body);
    // Wire format is exactly IV(12) + GCM tag(16) + ciphertext(=plaintext length,
    // GCM adds no padding) → plaintext bytes + 28.
    expect(raw.rows[0]!.len).toBe(Buffer.byteLength(body) + 12 + 16);
  });

  it("decrypts on read and bumps the thread's lastMessageAt", async () => {
    const msgs = await repo.listMessages(ORG_A, threadA);
    expect(msgs.map((m) => m.body)).toEqual(["SENSITIVE-BODY: please review my credit report"]);

    const thread = await repo.getThread(ORG_A, threadA);
    expect(thread?.lastMessageAt).toBe(T1.toISOString());
  });

  it("isolates by org: org B sees none of org A's threads or messages", async () => {
    expect(await repo.getThread(ORG_B, threadA)).toBeNull();
    expect(await repo.listThreads(ORG_B, clientA1)).toEqual([]);
    expect(await repo.listMessages(ORG_B, threadA)).toEqual([]);
  });

  it("rejects posting to a foreign-org thread (RLS-invisible → not found)", async () => {
    await expect(
      repo.postMessage(ORG_B, { threadId: threadA, senderRole: "staff", senderId: STAFF_A, body: "x" }, T2),
    ).rejects.toBeInstanceOf(ThreadNotFoundError);
  });

  it("rejects a client posting to a thread that is not their own", async () => {
    // clientA2 tries to post as themselves into clientA1's thread (same org).
    await expect(
      repo.postMessage(ORG_A, { threadId: threadA, senderRole: "client", senderId: clientA2, body: "hi" }, T2),
    ).rejects.toBeInstanceOf(NotThreadClientError);
  });

  it("rejects creating a thread for a client outside the org", async () => {
    await expect(
      repo.createThread(ORG_A, { clientId: clientB1, subject: "cross-org" }, T2),
    ).rejects.toBeInstanceOf(MessagingClientNotFoundError);
  });

  it("re-validates well-formedness: empty body is rejected", async () => {
    await expect(
      repo.postMessage(ORG_A, { threadId: threadA, senderRole: "staff", senderId: STAFF_A, body: "   " }, T2),
    ).rejects.toBeInstanceOf(MessageRejectedError);
  });

  it("drives read receipts: the client reads staff messages, idempotently", async () => {
    // The client reads → the one staff message becomes read-by-client.
    const first = await repo.markThreadRead(ORG_A, threadA, "client", T2);
    expect(first).toBe(1);
    // Second read is a no-op (nothing left unread).
    const second = await repo.markThreadRead(ORG_A, threadA, "client", T2);
    expect(second).toBe(0);

    const msgs = await repo.listMessages(ORG_A, threadA);
    expect(msgs[0]!.readByClientAt).toBe(T2.toISOString());
  });

  it("closes and reopens a thread; an illegal transition is rejected; a closed thread refuses posts", async () => {
    expect(await repo.setThreadStatus(ORG_A, threadA, "close", T2)).toBe("closed");
    // Posting to a closed thread is rejected by the kernel.
    await expect(
      repo.postMessage(ORG_A, { threadId: threadA, senderRole: "staff", senderId: STAFF_A, body: "after close" }, T2),
    ).rejects.toBeInstanceOf(MessageRejectedError);
    // Closing an already-closed thread is illegal.
    await expect(repo.setThreadStatus(ORG_A, threadA, "close", T2)).rejects.toBeInstanceOf(ThreadTransitionError);
    // Reopen restores posting.
    expect(await repo.setThreadStatus(ORG_A, threadA, "reopen", T2)).toBe("open");
    const ok = await repo.postMessage(
      ORG_A,
      { threadId: threadA, senderRole: "client", senderId: clientA1, body: "thanks!" },
      T2,
    );
    expect(ok.body).toBe("thanks!");
    expect(ok.readByClientAt).toBe(T2.toISOString()); // client's own message
  });

  it("lists a client's threads, most-recently-active first", async () => {
    const older = await repo.createThread(ORG_A, { clientId: clientA1, subject: "Older empty" }, T0);
    const threads = await repo.listThreads(ORG_A, clientA1);
    // threadA has messages (lastMessageAt set) → before the never-messaged one.
    expect(threads[0]!.id).toBe(threadA);
    expect(threads.some((t) => t.id === older.id)).toBe(true);
  });
});
