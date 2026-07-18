import type { OutboxRecord } from "./record";

/**
 * Deterministic outbox processing rules (outbox.v1.0.0).
 *
 * Pure functions over OutboxRecord — the worker applies the returned record
 * inside its transaction (`SELECT ... FOR UPDATE SKIP LOCKED`). Every
 * decision carries a reason code; illegal moves are rejected, never applied
 * silently. Jobs are idempotent: handlers key on the record id and must
 * tolerate re-delivery after a crash between claim and complete.
 */

export const OUTBOX_RULES_VERSION = "outbox.v1.0.0";

export type OutboxReasonCode =
  | "OB_OK"
  | "OB_NOT_YET_AVAILABLE"
  | "OB_ILLEGAL_TRANSITION"
  | "OB_TERMINAL_STATE"
  | "OB_DEAD_LETTERED"
  | "OB_MISSING_FAILURE_REASON"
  | "OB_MISSING_WORKER_ID";

export interface OutboxTransitionResult {
  allowed: boolean;
  reasonCode: OutboxReasonCode;
  ruleVersion: string;
  /** The next record state; present only when allowed. */
  record?: OutboxRecord;
}

const BASE_BACKOFF_MS = 30_000; // 30s
const MAX_BACKOFF_MS = 3_600_000; // 1h cap

/** Exponential backoff after the given completed attempt count (deterministic). */
export function backoffMs(attempts: number): number {
  const exp = BASE_BACKOFF_MS * 2 ** Math.max(0, attempts - 1);
  return Math.min(exp, MAX_BACKOFF_MS);
}

function deny(reasonCode: OutboxReasonCode): OutboxTransitionResult {
  return { allowed: false, reasonCode, ruleVersion: OUTBOX_RULES_VERSION };
}

function allow(record: OutboxRecord, reasonCode: OutboxReasonCode = "OB_OK"): OutboxTransitionResult {
  return { allowed: true, reasonCode, ruleVersion: OUTBOX_RULES_VERSION, record };
}

/** pending|failed → processing, only once nextAttemptAt has passed. */
export function claim(record: OutboxRecord, now: Date, workerId: string): OutboxTransitionResult {
  if (!workerId) return deny("OB_MISSING_WORKER_ID");
  if (record.status === "processed" || record.status === "dead_letter") {
    return deny("OB_TERMINAL_STATE");
  }
  if (record.status === "processing") return deny("OB_ILLEGAL_TRANSITION");
  if (new Date(record.nextAttemptAt) > now) return deny("OB_NOT_YET_AVAILABLE");
  return allow({
    ...record,
    status: "processing",
    attempts: record.attempts + 1,
    lockedBy: workerId,
    lockedAt: now.toISOString(),
  });
}

/** processing → processed. */
export function complete(record: OutboxRecord, now: Date): OutboxTransitionResult {
  if (record.status !== "processing") {
    return deny(record.status === "processed" || record.status === "dead_letter" ? "OB_TERMINAL_STATE" : "OB_ILLEGAL_TRANSITION");
  }
  return allow({
    ...record,
    status: "processed",
    processedAt: now.toISOString(),
    lockedBy: null,
    lockedAt: null,
  });
}

/**
 * processing → failed (with backoff) or dead_letter once maxAttempts is
 * exhausted. A failure reason is mandatory — silent failures are illegal.
 */
export function fail(record: OutboxRecord, now: Date, reason: string): OutboxTransitionResult {
  if (!reason.trim()) return deny("OB_MISSING_FAILURE_REASON");
  if (record.status !== "processing") {
    return deny(record.status === "processed" || record.status === "dead_letter" ? "OB_TERMINAL_STATE" : "OB_ILLEGAL_TRANSITION");
  }
  const base = { ...record, lastError: reason, lockedBy: null, lockedAt: null };
  if (record.attempts >= record.maxAttempts) {
    return allow({ ...base, status: "dead_letter" }, "OB_DEAD_LETTERED");
  }
  return allow({
    ...base,
    status: "failed",
    nextAttemptAt: new Date(now.getTime() + backoffMs(record.attempts)).toISOString(),
  });
}
