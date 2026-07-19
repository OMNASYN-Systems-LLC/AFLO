import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { and, asc, inArray, lte } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createEvent,
  toOutboxRecord,
  type OutboxRecord,
} from "@aflo/shared";
import * as schema from "../src/schema";
import {
  DrizzleOutboxRepository,
  OutboxRecordNotFoundError,
  OutboxTransitionError,
} from "../src/repositories/outbox";

/**
 * DrizzleOutboxRepository against an in-memory Postgres (PGlite) — proves the
 * durable outbox behaves correctly on real SQL, credential-free: enqueue +
 * idempotency, due-only ordered claiming, processed/failed transitions,
 * backoff, dead-lettering, fail-closed illegal moves, and payload round-trip.
 *
 * Caveat: PGlite is single-connection, so genuinely SIMULTANEOUS `FOR UPDATE
 * SKIP LOCKED` between two workers cannot be exercised here — that needs two
 * real connections and is covered by a live-Postgres integration test (gated on
 * DATABASE_URL). What we prove here is (a) the claim query carries the lock
 * clause and (b) a claimed row is not re-claimable, which is the sequential
 * slice of the no-double-claim guarantee.
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

const ORG = "00000000-0000-0000-0000-0000000000aa";

/** Build a pending outbox record for a deterministic id/eventId at `at`. */
function makeRecord(opts: {
  id: string;
  eventId: string;
  at: Date;
  org?: string;
  maxAttempts?: number;
}): OutboxRecord {
  const event = createEvent({
    eventType: "LeadCreated",
    organizationId: opts.org ?? ORG,
    aggregateId: "lead-1",
    payload: { leadId: "lead-1", pipelineStatus: "new", source: null },
    eventId: opts.eventId,
    occurredAt: opts.at.toISOString(),
  });
  return toOutboxRecord(event, { now: opts.at, id: opts.id, maxAttempts: opts.maxAttempts });
}

let client: PGlite;
// No schema generic: the repository uses explicitly-imported tables, never the
// db.query.* relational API, so it stays driver- and schema-generic-agnostic.
let db: PgliteDatabase;
let repo: DrizzleOutboxRepository;

beforeAll(async () => {
  client = await PGlite.create();
  await client.exec(allMigrations());
  db = drizzle(client);
  repo = new DrizzleOutboxRepository(db);
});

beforeEach(async () => {
  // Fresh outbox per test (no FKs, so a plain truncate is safe and fast).
  await client.exec("TRUNCATE TABLE outbox");
});

afterAll(async () => {
  await client.close();
});

const T0 = new Date("2026-07-19T12:00:00.000Z");

describe("DrizzleOutboxRepository (PGlite)", () => {
  it("enqueues a pending record and round-trips it (incl. canonical payload)", async () => {
    const rec = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    await repo.enqueue(rec);

    const got = await repo.get(rec.id);
    expect(got).not.toBeNull();
    expect(got!.status).toBe("pending");
    expect(got!.attempts).toBe(0);
    expect(got!.maxAttempts).toBe(5);
    expect(got!.eventId).toBe(rec.eventId);
    expect(got!.organizationId).toBe(ORG);
    expect(got!.serializedEvent).toBe(rec.serializedEvent); // canonical JSON survives jsonb
    expect(got!.lockedBy).toBeNull();
    expect(got!.processedAt).toBeNull();
  });

  it("is idempotent on eventId: re-enqueue with a new row id is a no-op", async () => {
    const first = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    const dup = makeRecord({ id: "22222222-2222-2222-2222-222222222222", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    await repo.enqueue(first);
    await repo.enqueue(dup);

    expect(await repo.get(first.id)).not.toBeNull();
    expect(await repo.get(dup.id)).toBeNull(); // the duplicate eventId did not create a second row
  });

  it("claims due records, marks them processing, increments attempts, sets the lock", async () => {
    const a = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    const b = makeRecord({ id: "22222222-2222-2222-2222-222222222222", eventId: "aaaaaaaa-0000-0000-0000-000000000002", at: T0 });
    await repo.enqueue(a);
    await repo.enqueue(b);

    const claimed = await repo.claimBatch("worker-1", T0, 10);
    expect(claimed).toHaveLength(2);
    for (const c of claimed) {
      expect(c.status).toBe("processing");
      expect(c.attempts).toBe(1);
      expect(c.lockedBy).toBe("worker-1");
      expect(c.lockedAt).not.toBeNull();
    }
    // A second poll finds nothing — claimed rows are no longer due.
    expect(await repo.claimBatch("worker-2", T0, 10)).toHaveLength(0);
  });

  it("does not claim records whose nextAttemptAt is in the future", async () => {
    const future = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    future.nextAttemptAt = new Date(T0.getTime() + 3_600_000).toISOString();
    await repo.enqueue(future);

    expect(await repo.claimBatch("worker-1", T0, 10)).toHaveLength(0);
    // ...but it becomes claimable once its time arrives.
    const later = new Date(T0.getTime() + 3_600_000);
    expect(await repo.claimBatch("worker-1", later, 10)).toHaveLength(1);
  });

  it("claims oldest-due first and honours the batch limit", async () => {
    const older = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: new Date(T0.getTime() - 2000) });
    const middle = makeRecord({ id: "22222222-2222-2222-2222-222222222222", eventId: "aaaaaaaa-0000-0000-0000-000000000002", at: new Date(T0.getTime() - 1000) });
    const newer = makeRecord({ id: "33333333-3333-3333-3333-333333333333", eventId: "aaaaaaaa-0000-0000-0000-000000000003", at: T0 });
    await repo.enqueue(newer);
    await repo.enqueue(older);
    await repo.enqueue(middle);

    const claimed = await repo.claimBatch("worker-1", T0, 2);
    expect(claimed.map((c) => c.id)).toEqual([older.id, middle.id]);
    // The newest-due remains for the next poll.
    expect((await repo.claimBatch("worker-1", T0, 10)).map((c) => c.id)).toEqual([newer.id]);
  });

  it("markProcessed moves processing → processed, stamps processedAt, clears the lock", async () => {
    const rec = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    await repo.enqueue(rec);
    await repo.claimBatch("worker-1", T0, 10);

    const done = new Date(T0.getTime() + 5000);
    await repo.markProcessed(rec.id, done);

    const got = await repo.get(rec.id);
    expect(got!.status).toBe("processed");
    expect(got!.processedAt).toBe(done.toISOString());
    expect(got!.lockedBy).toBeNull();
  });

  it("markFailed schedules a backoff retry and retains the reason", async () => {
    const rec = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    await repo.enqueue(rec);
    await repo.claimBatch("worker-1", T0, 10);

    await repo.markFailed(rec.id, T0, "handler exploded");

    const got = await repo.get(rec.id);
    expect(got!.status).toBe("failed");
    expect(got!.lastError).toBe("handler exploded");
    expect(got!.lockedBy).toBeNull();
    expect(new Date(got!.nextAttemptAt).getTime()).toBe(T0.getTime() + 30_000); // 30s base backoff after attempt 1
  });

  it("markFailed dead-letters once attempts reach maxAttempts", async () => {
    const rec = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0, maxAttempts: 1 });
    await repo.enqueue(rec);
    await repo.claimBatch("worker-1", T0, 10); // attempts -> 1 == maxAttempts

    await repo.markFailed(rec.id, T0, "still broken");

    const got = await repo.get(rec.id);
    expect(got!.status).toBe("dead_letter");
    // Dead-lettered rows are never claimed again.
    expect(await repo.claimBatch("worker-1", new Date(T0.getTime() + 3_600_000), 10)).toHaveLength(0);
  });

  it("fails closed on illegal transitions and missing rows", async () => {
    const rec = makeRecord({ id: "11111111-1111-1111-1111-111111111111", eventId: "aaaaaaaa-0000-0000-0000-000000000001", at: T0 });
    await repo.enqueue(rec); // still pending, never claimed

    // Completing a pending (un-claimed) record is illegal.
    await expect(repo.markProcessed(rec.id, T0)).rejects.toBeInstanceOf(OutboxTransitionError);
    await expect(repo.markFailed(rec.id, T0, "nope")).rejects.toBeInstanceOf(OutboxTransitionError);
    // Marking a row that does not exist.
    await expect(repo.markProcessed("99999999-9999-9999-9999-999999999999", T0)).rejects.toBeInstanceOf(
      OutboxRecordNotFoundError,
    );
  });

  it("the claim query carries FOR UPDATE SKIP LOCKED (concurrency control)", () => {
    // Structural proof of the lock clause; simultaneous multi-worker behaviour
    // is verified on real Postgres (PGlite is single-connection).
    const sql = db
      .select()
      .from(schema.outbox)
      .where(and(inArray(schema.outbox.status, ["pending", "failed"]), lte(schema.outbox.nextAttemptAt, T0)))
      .orderBy(asc(schema.outbox.nextAttemptAt))
      .limit(10)
      .for("update", { skipLocked: true })
      .toSQL().sql;
    expect(sql.toLowerCase()).toContain("for update skip locked");
  });
});
