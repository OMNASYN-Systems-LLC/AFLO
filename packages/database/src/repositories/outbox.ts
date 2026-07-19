import { and, asc, eq, inArray, lte } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import {
  claim,
  complete,
  expireLock,
  fail,
  serializeEvent,
  type DomainEvent,
  type OutboxRecord,
  type OutboxRepository,
  type OutboxStatus,
  type OutboxTransitionResult,
} from "@aflo/shared";
import { outbox } from "../schema";

/**
 * PostgreSQL transactional outbox (Drizzle), behind the @aflo/shared
 * OutboxRepository contract. All state changes are driven through the shared
 * outbox.v1.0.0 transitions, so retry/backoff/dead-letter/crash-recovery
 * behaviour is identical to any other implementation — this class only adds
 * durable storage and the `FOR UPDATE SKIP LOCKED` concurrency control the
 * worker relies on.
 *
 * The handle is driver-agnostic (PGlite in tests, node-postgres/Neon in the
 * worker), so the same code path proven credential-free on PGlite runs in
 * production.
 *
 * DEPLOYMENT: the worker drains every organization, so it MUST connect under an
 * RLS-BYPASSING role — migration 0003 FORCE-enables org_isolation on the outbox,
 * and a non-privileged role without `app.current_org_id` set would see zero due
 * rows and have its inserts rejected (see OutboxRepository docs). The
 * `rls-runtime.test.ts` proves that failure mode is real.
 */
export type OutboxDrizzleDb = PgDatabase<PgQueryResultHKT>;

/**
 * The due-claim query: `pending`/`failed` records past their `next_attempt_at`,
 * oldest-due first, locked `FOR UPDATE SKIP LOCKED` so two workers polling at
 * once never receive the same row. Extracted so the concurrency test asserts
 * the SAME query the repository runs (not a re-derived lookalike).
 */
export function selectDueForClaim(qb: OutboxDrizzleDb, now: Date, limit: number) {
  return qb
    .select()
    .from(outbox)
    .where(and(inArray(outbox.status, ["pending", "failed"]), lte(outbox.nextAttemptAt, now)))
    .orderBy(asc(outbox.nextAttemptAt))
    .limit(limit)
    .for("update", { skipLocked: true });
}

/** A `select().from(outbox)` row — Date columns, jsonb payload object. */
type OutboxRow = typeof outbox.$inferSelect;

/** Thrown when marking a record that no longer exists. */
export class OutboxRecordNotFoundError extends Error {
  constructor(public readonly id: string) {
    super(`outbox record not found: ${id}`);
    this.name = "OutboxRecordNotFoundError";
  }
}

/** Thrown when a transition is illegal for the record's current state. */
export class OutboxTransitionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(`illegal outbox transition: ${reasonCode}`);
    this.name = "OutboxTransitionError";
  }
}

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

/** Map a persisted row to the domain record; re-serialize the payload canonically. */
function toRecord(row: OutboxRow): OutboxRecord {
  return {
    id: row.id,
    eventId: row.eventId,
    idempotencyKey: `${row.eventType}:${row.eventId}`,
    organizationId: row.organizationId,
    eventType: row.eventType as OutboxRecord["eventType"],
    eventVersion: row.eventVersion,
    aggregateType: row.aggregateType,
    aggregateId: row.aggregateId,
    serializedEvent: serializeEvent(row.payload as DomainEvent),
    status: row.status as OutboxStatus,
    attempts: row.attempts,
    maxAttempts: row.maxAttempts,
    nextAttemptAt: row.nextAttemptAt.toISOString(),
    lockedBy: row.lockedBy,
    lockedAt: isoOrNull(row.lockedAt),
    lastError: row.lastError,
    processedAt: isoOrNull(row.processedAt),
    createdAt: row.createdAt.toISOString(),
  };
}

/** The mutable columns a transition can change, written back after every move. */
function toStateColumns(record: OutboxRecord) {
  return {
    status: record.status,
    attempts: record.attempts,
    nextAttemptAt: new Date(record.nextAttemptAt),
    lockedBy: record.lockedBy,
    lockedAt: record.lockedAt === null ? null : new Date(record.lockedAt),
    lastError: record.lastError,
    deadLetter: record.status === "dead_letter",
    processedAt: record.processedAt === null ? null : new Date(record.processedAt),
  };
}

/**
 * Insert a pending outbox row on the given handle (a db OR a transaction).
 * Idempotent on the producer-side anchor `event_id`, so a retried producer
 * transaction that re-enqueues the same event is a no-op. Taking a handle
 * lets producers insert the event in the SAME transaction as the state change
 * that emitted it (see `commitWithOutbox`).
 */
export async function insertOutboxRecord(qb: OutboxDrizzleDb, record: OutboxRecord): Promise<void> {
  await qb
    .insert(outbox)
    .values({
      id: record.id,
      eventId: record.eventId,
      eventType: record.eventType,
      eventVersion: record.eventVersion,
      organizationId: record.organizationId,
      aggregateType: record.aggregateType,
      aggregateId: record.aggregateId,
      payload: JSON.parse(record.serializedEvent),
      status: record.status,
      attempts: record.attempts,
      maxAttempts: record.maxAttempts,
      nextAttemptAt: new Date(record.nextAttemptAt),
      lockedBy: record.lockedBy,
      lockedAt: record.lockedAt === null ? null : new Date(record.lockedAt),
      lastError: record.lastError,
      deadLetter: record.status === "dead_letter",
      processedAt: record.processedAt === null ? null : new Date(record.processedAt),
      createdAt: new Date(record.createdAt),
    })
    .onConflictDoNothing({ target: outbox.eventId });
}

/**
 * Transactional-outbox WRITE (ADR-0008): run `work` and flush the outbox rows
 * it collects in ONE transaction, so a state change and the events it emits
 * commit together or not at all. An event is never emitted for a change that
 * rolled back, and a change never commits without its events — the invariant
 * the whole outbox depends on. `work` performs its domain writes on the `tx`
 * handle and calls `enqueue(record)` for each event; the records are inserted
 * when `work` resolves, inside the same transaction. If `work` throws — or any
 * outbox insert fails — the entire unit of work rolls back.
 *
 * In the app this runs under the request's verified org context (RLS on); the
 * worker's crash-recovery path is the separate consumer side.
 */
export async function commitWithOutbox<T>(
  db: OutboxDrizzleDb,
  work: (tx: OutboxDrizzleDb, enqueue: (record: OutboxRecord) => void) => Promise<T>,
): Promise<T> {
  return db.transaction(async (tx) => {
    const pending: OutboxRecord[] = [];
    const result = await work(tx, (record) => pending.push(record));
    for (const record of pending) await insertOutboxRecord(tx, record);
    return result;
  });
}

export class DrizzleOutboxRepository implements OutboxRepository {
  constructor(private readonly db: OutboxDrizzleDb) {}

  async enqueue(record: OutboxRecord): Promise<void> {
    await insertOutboxRecord(this.db, record);
  }

  async claimBatch(workerId: string, now: Date, limit: number): Promise<OutboxRecord[]> {
    return this.db.transaction(async (tx) => {
      const due = await selectDueForClaim(tx, now, limit);
      const claimed: OutboxRecord[] = [];
      for (const row of due) {
        const result = claim(toRecord(row), now, workerId);
        if (!result.allowed || !result.record) continue; // WHERE already filtered; belt-and-suspenders
        await tx.update(outbox).set(toStateColumns(result.record)).where(eq(outbox.id, result.record.id));
        claimed.push(result.record);
      }
      return claimed;
    });
  }

  async reapExpired(now: Date, visibilityTimeoutMs: number, limit: number): Promise<OutboxRecord[]> {
    return this.db.transaction(async (tx) => {
      const cutoff = new Date(now.getTime() - visibilityTimeoutMs);
      const stale = await tx
        .select()
        .from(outbox)
        .where(and(eq(outbox.status, "processing"), lte(outbox.lockedAt, cutoff)))
        .orderBy(asc(outbox.lockedAt))
        .limit(limit)
        .for("update", { skipLocked: true });

      const reaped: OutboxRecord[] = [];
      for (const row of stale) {
        const result = expireLock(toRecord(row), now, visibilityTimeoutMs);
        if (!result.allowed || !result.record) continue; // WHERE already filtered; belt-and-suspenders
        await tx.update(outbox).set(toStateColumns(result.record)).where(eq(outbox.id, result.record.id));
        reaped.push(result.record);
      }
      return reaped;
    });
  }

  async markProcessed(id: string, now: Date): Promise<void> {
    await this.applyTransition(id, (record) => complete(record, now));
  }

  async markFailed(id: string, now: Date, reason: string): Promise<void> {
    await this.applyTransition(id, (record) => fail(record, now, reason));
  }

  async get(id: string): Promise<OutboxRecord | null> {
    const rows = await this.db.select().from(outbox).where(eq(outbox.id, id)).limit(1);
    return rows[0] ? toRecord(rows[0]) : null;
  }

  /** Load-lock-transition-write, all inside one transaction. */
  private async applyTransition(
    id: string,
    transition: (record: OutboxRecord) => OutboxTransitionResult,
  ): Promise<void> {
    await this.db.transaction(async (tx) => {
      const rows = await tx
        .select()
        .from(outbox)
        .where(eq(outbox.id, id))
        .limit(1)
        .for("update");
      const row = rows[0];
      if (!row) throw new OutboxRecordNotFoundError(id);
      const result = transition(toRecord(row));
      if (!result.allowed || !result.record) throw new OutboxTransitionError(result.reasonCode);
      await tx.update(outbox).set(toStateColumns(result.record)).where(eq(outbox.id, id));
    });
  }
}
