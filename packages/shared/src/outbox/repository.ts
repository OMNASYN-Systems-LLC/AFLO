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
 * outbox.v1.0.0 transitions (`claim` / `complete` / `fail`), so retry, backoff,
 * and dead-lettering are deterministic and identical regardless of the backing
 * store. The worker drains events across all organizations, so it runs under a
 * privileged (RLS-bypassing) database role; the org_isolation RLS policy still
 * protects the outbox from ordinary app-layer roles.
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

  /** Fetch a record by id (diagnostics / dead-letter review); null when absent. */
  get(id: string): Promise<OutboxRecord | null>;
}
