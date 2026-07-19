import { describe, expect, it } from "vitest";
import { createEvent, deserializeEvent } from "../src/events";
import {
  backoffMs,
  claim,
  complete,
  DEFAULT_MAX_ATTEMPTS,
  expireLock,
  fail,
  OUTBOX_RULES_VERSION,
  toOutboxRecord,
  VISIBILITY_TIMEOUT_MS,
  type OutboxRecord,
} from "../src/outbox";

const NOW = new Date("2026-07-18T12:00:00.000Z");
const LATER = new Date("2026-07-18T12:05:00.000Z");

function record(): OutboxRecord {
  const event = createEvent({
    eventType: "LeadCreated",
    organizationId: "org-golden-key",
    aggregateId: "l-cole",
    actorId: "s-lin",
    eventId: "11111111-1111-4111-8111-111111111111",
    occurredAt: NOW.toISOString(),
    payload: { leadId: "l-cole", pipelineStatus: "new_lead", source: null },
  });
  return toOutboxRecord(event, { id: "ob-1", now: NOW });
}

describe("toOutboxRecord", () => {
  it("builds a pending record carrying the full serialized envelope", () => {
    const r = record();
    expect(r.status).toBe("pending");
    expect(r.attempts).toBe(0);
    expect(r.maxAttempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(r.idempotencyKey).toBe("LeadCreated:11111111-1111-4111-8111-111111111111");
    expect(r.organizationId).toBe("org-golden-key");
    expect(r.nextAttemptAt).toBe(NOW.toISOString());
    // The envelope round-trips out of the stored payload.
    expect(deserializeEvent(r.serializedEvent).eventId).toBe(r.eventId);
  });
});

describe("claim", () => {
  it("claims an available pending record and increments attempts", () => {
    const res = claim(record(), NOW, "worker-1");
    expect(res).toMatchObject({ allowed: true, reasonCode: "OB_OK", ruleVersion: OUTBOX_RULES_VERSION });
    expect(res.record).toMatchObject({ status: "processing", attempts: 1, lockedBy: "worker-1" });
  });

  it("refuses future-scheduled, already-processing, terminal, and anonymous claims", () => {
    const notYet = { ...record(), nextAttemptAt: LATER.toISOString() };
    expect(claim(notYet, NOW, "w").reasonCode).toBe("OB_NOT_YET_AVAILABLE");
    const processing = claim(record(), NOW, "w").record!;
    expect(claim(processing, NOW, "w").reasonCode).toBe("OB_ILLEGAL_TRANSITION");
    const processed = complete(processing, NOW).record!;
    expect(claim(processed, LATER, "w").reasonCode).toBe("OB_TERMINAL_STATE");
    expect(claim(record(), NOW, "").reasonCode).toBe("OB_MISSING_WORKER_ID");
  });

  it("allows re-claiming a failed record once backoff has elapsed", () => {
    const processing = claim(record(), NOW, "w").record!;
    const failed = fail(processing, NOW, "provider timeout").record!;
    expect(claim(failed, NOW, "w").reasonCode).toBe("OB_NOT_YET_AVAILABLE");
    const afterBackoff = new Date(new Date(failed.nextAttemptAt).getTime() + 1);
    const reclaimed = claim(failed, afterBackoff, "w2");
    expect(reclaimed.allowed).toBe(true);
    expect(reclaimed.record?.attempts).toBe(2);
  });
});

describe("complete", () => {
  it("completes a processing record and releases the lock", () => {
    const processing = claim(record(), NOW, "w").record!;
    const res = complete(processing, LATER);
    expect(res.record).toMatchObject({
      status: "processed",
      processedAt: LATER.toISOString(),
      lockedBy: null,
    });
  });

  it("rejects completing anything not processing", () => {
    expect(complete(record(), NOW).reasonCode).toBe("OB_ILLEGAL_TRANSITION");
  });
});

describe("fail", () => {
  it("requires a failure reason — silent failures are illegal", () => {
    const processing = claim(record(), NOW, "w").record!;
    expect(fail(processing, NOW, "  ").reasonCode).toBe("OB_MISSING_FAILURE_REASON");
  });

  it("schedules exponential backoff and retains the error", () => {
    const processing = claim(record(), NOW, "w").record!;
    const res = fail(processing, NOW, "resend 503");
    expect(res.record).toMatchObject({ status: "failed", lastError: "resend 503", lockedBy: null });
    expect(new Date(res.record!.nextAttemptAt).getTime()).toBe(NOW.getTime() + backoffMs(1));
  });

  it("dead-letters after max attempts and stays terminal", () => {
    let r = record();
    for (let i = 0; i < DEFAULT_MAX_ATTEMPTS; i++) {
      const claimed = claim({ ...r, nextAttemptAt: NOW.toISOString() }, NOW, "w");
      expect(claimed.allowed).toBe(true);
      r = fail(claimed.record!, NOW, `attempt ${i + 1} failed`).record!;
    }
    expect(r.status).toBe("dead_letter");
    expect(r.attempts).toBe(DEFAULT_MAX_ATTEMPTS);
    expect(claim(r, LATER, "w").reasonCode).toBe("OB_TERMINAL_STATE");
    expect(fail(r, LATER, "x").reasonCode).toBe("OB_TERMINAL_STATE");
  });
});

describe("expireLock (crash recovery)", () => {
  it("leaves a lock that is still inside the visibility window untouched", () => {
    const processing = claim(record(), NOW, "w").record!;
    const withinWindow = new Date(NOW.getTime() + VISIBILITY_TIMEOUT_MS - 1);
    expect(expireLock(processing, withinWindow, VISIBILITY_TIMEOUT_MS).reasonCode).toBe("OB_LOCK_HELD");
  });

  it("returns an abandoned lock to the retry path, immediately due", () => {
    const processing = claim(record(), NOW, "w").record!;
    const expired = new Date(NOW.getTime() + VISIBILITY_TIMEOUT_MS);
    const res = expireLock(processing, expired, VISIBILITY_TIMEOUT_MS);
    expect(res.reasonCode).toBe("OB_LOCK_EXPIRED");
    expect(res.record).toMatchObject({ status: "failed", lockedBy: null, lockedAt: null });
    expect(res.record!.nextAttemptAt).toBe(expired.toISOString()); // reclaimable now, not after backoff
    // A subsequent claim picks it up and counts the retry.
    expect(claim(res.record!, expired, "w2").record?.attempts).toBe(2);
  });

  it("dead-letters a poison record instead of reclaiming it forever", () => {
    // A record already at maxAttempts whose worker crashed must not loop.
    const r = { ...record(), maxAttempts: 1 };
    const processing = claim(r, NOW, "w").record!; // attempts -> 1 == maxAttempts
    const expired = new Date(NOW.getTime() + VISIBILITY_TIMEOUT_MS);
    const res = expireLock(processing, expired, VISIBILITY_TIMEOUT_MS);
    expect(res.reasonCode).toBe("OB_DEAD_LETTERED");
    expect(res.record?.status).toBe("dead_letter");
  });

  it("refuses to expire anything not processing", () => {
    expect(expireLock(record(), LATER, VISIBILITY_TIMEOUT_MS).reasonCode).toBe("OB_ILLEGAL_TRANSITION");
    const processed = complete(claim(record(), NOW, "w").record!, NOW).record!;
    expect(expireLock(processed, LATER, VISIBILITY_TIMEOUT_MS).reasonCode).toBe("OB_TERMINAL_STATE");
  });
});

describe("backoffMs", () => {
  it("doubles per attempt and caps at one hour", () => {
    expect(backoffMs(1)).toBe(30_000);
    expect(backoffMs(2)).toBe(60_000);
    expect(backoffMs(5)).toBe(480_000);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
