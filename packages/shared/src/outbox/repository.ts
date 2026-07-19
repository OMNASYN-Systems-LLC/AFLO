import type { OutboxRecord } from "./record";

/**
 * Durable transactional-outbox contract (DATABASE_SCHEMA.md §9.4).
 *
 * Producers `enqueue` a record in the SAME transaction as the state change
 * that emitted the event, so an event is never lost and never emitted for a
 * change that rolled back. The Railway worker `claimBatch`es due records,
 * processes each idempotently (handlers key on the record id), and records the
 * outcome via `markProcessed` / `markFailed`.
 *
 * Every implementation MUST drive its state changes through the shared
 * outbox.v1.0.0 transitions (`claim` / `complete` / `fail` / `expireLock`), so
 * retry, backoff, dead-lettering, and crash recovery are deterministic and
 * identical regardless of the backing store.
 *
 * DEPLOYMENT REQUIREMENT — the worker drains events across ALL organizations,
 * so it MUST connect under a privileged, RLS-BYPASSING database role. Migration
 * 0003 FORCE-enables the `org_isolation` RLS policy on the outbox; a worker on
 * an ordinary role WITHOUT `app.current_org_id` set sees zero due rows (the
 * USING clause is false) and its inserts are rejected (WITH CHECK) — it would
 * silently drain nothing. The RLS policy still protects the outbox from
 * ordinary app-layer (web) roles; the worker is the sole privileged consumer.
 */
export interface OutboxRepository {
  /**
   * Insert a pending record. Idempotent on `eventId` (the producer-side
   * idempotency anchor): a duplicate `eventId` is a no-op, so a retried
   * producer transaction never double-enqueues the same event.
   */
  enqueue(record: OutboxRecord): Promise<void>;

  /**
   * Atomically claim up to `limit` records that are DUE — `pending` or `failed`
   * with `nextAttemptAt <= now` — oldest-due first, marking each `processing`
   * and locked to `workerId`. Uses `FOR UPDATE SKIP LOCKED` so concurrent
   * workers never receive the same row. Returns the claimed records in their
   * post-claim state (attempts incremented, lock set).
   */
  claimBatch(workerId: string, now: Date, limit: number): Promise<OutboxRecord[]>;

  /**
   * Mark a `processing` record `processed`. Throws when the row is absent or is
   * not in `processing` (marking a row you did not claim is a logic error).
   */
  markProcessed(id: string, now: Date): Promise<void>;

  /**
   * Mark a `processing` record failed: schedule a backoff retry, or move it to
   * `dead_letter` once `attempts` reaches `maxAttempts`. `reason` is mandatory —
   * silent failures are illegal. Throws when the row is absent or not
   * `processing`.
   */
  markFailed(id: string, now: Date, reason: string): Promise<void>;

  /**
   * Recover records stranded in `processing` by a crashed worker: any whose
   * lock is older than `visibilityTimeoutMs` is returned to the retry path
   * (immediately due), or dead-lettered once attempts are exhausted. The worker
   * MUST call this each poll (before `claimBatch`) — without it, a crash
   * between claim and complete strands the event forever and breaks the
   * at-least-once guarantee. Returns the reclaimed records.
   */
  reapExpired(now: Date, visibilityTimeoutMs: number, limit: number): Promise<OutboxRecord[]>;

  /** Fetch a record by id (diagnostics / dead-letter review); null when absent. */
  get(id: string): Promise<OutboxRecord | null>;
}
