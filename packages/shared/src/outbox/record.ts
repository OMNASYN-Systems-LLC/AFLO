import { serializeEvent, type DomainEvent, type EventType } from "../events";

/**
 * Typed contract for the PostgreSQL outbox (DATABASE_SCHEMA.md §9.4).
 *
 * Producers insert an OutboxRecord in the same transaction as the state
 * change that emitted the event; the Railway worker polls, processes
 * idempotently, and records the result. Field names mirror the DDL columns
 * (camelCased). Founder-term equivalences: available_at ≡ next_attempt_at,
 * failure_reason ≡ last_error, attempt_count ≡ attempts.
 */

export const OUTBOX_STATUSES = [
  "pending",
  "processing",
  "processed",
  "failed",
  "dead_letter",
] as const;

export type OutboxStatus = (typeof OUTBOX_STATUSES)[number];

export const DEFAULT_MAX_ATTEMPTS = 5;

export interface OutboxRecord {
  /** Outbox row id — the handler-side idempotency key. */
  id: string;
  /** The envelope's eventId — unique; the producer-side idempotency anchor. */
  eventId: string;
  /** Consumer-side dedupe key: `${eventType}:${eventId}`. */
  idempotencyKey: string;
  organizationId: string;
  eventType: EventType;
  eventVersion: number;
  aggregateType: string;
  aggregateId: string;
  /** Full DomainEvent envelope, deterministically serialized (payload column). */
  serializedEvent: string;
  status: OutboxStatus;
  /** Completed processing attempts (incremented on claim). */
  attempts: number;
  maxAttempts: number;
  /** Earliest time the record may next be claimed (backoff target). */
  nextAttemptAt: string; // ISO datetime
  /** Worker instance currently holding the record; null when unclaimed. */
  lockedBy: string | null;
  lockedAt: string | null;
  /** Most recent failure reason; retained across retries for dead-letter review. */
  lastError: string | null;
  processedAt: string | null;
  createdAt: string;
}

export interface ToOutboxRecordOptions {
  /** Row id — injectable for deterministic tests; defaults to crypto.randomUUID(). */
  id?: string;
  now: Date;
  maxAttempts?: number;
}

/** Build a pending outbox record from a validated domain event. */
export function toOutboxRecord(event: DomainEvent, opts: ToOutboxRecordOptions): OutboxRecord {
  const nowIso = opts.now.toISOString();
  return {
    id: opts.id ?? crypto.randomUUID(),
    eventId: event.eventId,
    idempotencyKey: `${event.eventType}:${event.eventId}`,
    organizationId: event.organizationId,
    eventType: event.eventType,
    eventVersion: event.eventVersion,
    aggregateType: event.aggregateType,
    aggregateId: event.aggregateId,
    serializedEvent: serializeEvent(event),
    status: "pending",
    attempts: 0,
    maxAttempts: opts.maxAttempts ?? DEFAULT_MAX_ATTEMPTS,
    nextAttemptAt: nowIso,
    lockedBy: null,
    lockedAt: null,
    lastError: null,
    processedAt: null,
    createdAt: nowIso,
  };
}
