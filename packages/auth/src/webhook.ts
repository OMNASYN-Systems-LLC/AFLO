/**
 * Clerk (Svix) webhook signature verification (founder directive PHASE 3).
 *
 * SERVER-ONLY. This module imports `node:crypto` and must never enter a client
 * bundle, so it is deliberately NOT re-exported from the package barrel
 * (`index.ts`). Import it via the explicit subpath: `@aflo/auth/webhook`.
 *
 * Clerk delivers webhooks through Svix. Each request carries three headers —
 * `svix-id`, `svix-timestamp`, `svix-signature` — and the signature is
 * `base64(HMAC-SHA256(key, `${id}.${timestamp}.${rawBody}`))`, where `key` is the
 * base64-decoded secret after the `whsec_` prefix. Verification is pure and
 * credential-free given a secret + payload; the real secret
 * (`CLERK_WEBHOOK_SECRET`) is supplied in the deployment. An UNSIGNED or invalid
 * webhook is never processed (fail closed).
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export const WEBHOOK_EVENT_TYPES = [
  "user.created",
  "user.updated",
  "user.deleted",
  "organization.created",
  "organization.updated",
  "organizationMembership.created",
  "organizationMembership.updated",
  "organizationMembership.deleted",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];

export interface WebhookHeaders {
  "svix-id"?: string | null;
  "svix-timestamp"?: string | null;
  "svix-signature"?: string | null;
}

export type WebhookVerificationFailure =
  | "missing_headers"
  | "malformed_secret"
  | "invalid_timestamp"
  | "timestamp_out_of_tolerance"
  | "no_signatures"
  | "signature_mismatch";

/** Thrown on any verification failure. Carries a stable reason; never a secret. */
export class WebhookVerificationError extends Error {
  constructor(public readonly reason: WebhookVerificationFailure) {
    super(`webhook verification failed: ${reason}`);
    this.name = "WebhookVerificationError";
  }
}

export interface VerifyWebhookInput {
  /** The RAW request body, exactly as received (signature is over the raw bytes). */
  payload: string;
  headers: WebhookHeaders;
  /** The Clerk/Svix signing secret (`whsec_…`). */
  secret: string;
  /** Max clock skew, seconds (default 300). */
  toleranceSeconds?: number;
  /** Current time in Unix seconds; injectable for deterministic tests. */
  nowSeconds?: number;
}

export interface VerifiedWebhook {
  id: string;
  timestamp: number;
  event: WebhookEvent;
}

/**
 * A parsed Clerk event. A type outside the handled set is surfaced as
 * `unhandled` (with the raw type) rather than throwing — unknown events are
 * ignored, not errors.
 */
export type WebhookEvent =
  | { type: WebhookEventType; data: Record<string, unknown> }
  | { type: "unhandled"; rawType: string; data: unknown };

function str(value: string | null | undefined): string {
  return typeof value === "string" ? value : "";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Decode the Svix signing key from a `whsec_…` (or bare base64) secret. */
function decodeSecret(secret: string): Buffer {
  const raw = secret.startsWith("whsec_") ? secret.slice("whsec_".length) : secret;
  if (raw.length === 0) throw new WebhookVerificationError("malformed_secret");
  const key = Buffer.from(raw, "base64");
  if (key.length === 0) throw new WebhookVerificationError("malformed_secret");
  return key;
}

/**
 * Verify a Clerk/Svix webhook. Returns the parsed event on success; throws
 * `WebhookVerificationError` (never processing the payload) on any failure:
 * missing headers, malformed secret, a non-integer or out-of-tolerance
 * timestamp, or no matching `v1` signature. The signature comparison is
 * constant-time.
 */
export function verifyWebhook(input: VerifyWebhookInput): VerifiedWebhook {
  const svixId = str(input.headers["svix-id"]);
  const svixTimestamp = str(input.headers["svix-timestamp"]);
  const svixSignature = str(input.headers["svix-signature"]);
  if (!svixId || !svixTimestamp || !svixSignature) {
    throw new WebhookVerificationError("missing_headers");
  }

  const timestamp = Number(svixTimestamp);
  if (!Number.isInteger(timestamp)) throw new WebhookVerificationError("invalid_timestamp");
  const tolerance = input.toleranceSeconds ?? 300;
  const now = input.nowSeconds ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - timestamp) > tolerance) {
    throw new WebhookVerificationError("timestamp_out_of_tolerance");
  }

  const key = decodeSecret(input.secret);
  const signedContent = `${svixId}.${svixTimestamp}.${input.payload}`;
  const expected = createHmac("sha256", key).update(signedContent, "utf8").digest();

  // The header is a space-separated list of `version,signature` (e.g. "v1,abc v1,def").
  const candidates = svixSignature
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const comma = part.indexOf(",");
      return comma === -1 ? null : { version: part.slice(0, comma), sig: part.slice(comma + 1) };
    })
    .filter((c): c is { version: string; sig: string } => c !== null && c.version === "v1");

  if (candidates.length === 0) throw new WebhookVerificationError("no_signatures");

  const matches = candidates.some((c) => {
    const their = Buffer.from(c.sig, "base64");
    return their.length === expected.length && timingSafeEqual(their, expected);
  });
  if (!matches) throw new WebhookVerificationError("signature_mismatch");

  return { id: svixId, timestamp, event: parseWebhookEvent(input.payload) };
}

/** Parse a Clerk event envelope `{ type, data }`. Defensive: never throws. */
export function parseWebhookEvent(payload: string): WebhookEvent {
  let parsed: unknown;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return { type: "unhandled", rawType: "", data: null };
  }
  if (!isRecord(parsed) || typeof parsed.type !== "string") {
    return { type: "unhandled", rawType: "", data: parsed };
  }
  const rawType = parsed.type;
  const data = isRecord(parsed.data) ? parsed.data : {};
  if ((WEBHOOK_EVENT_TYPES as readonly string[]).includes(rawType)) {
    return { type: rawType as WebhookEventType, data };
  }
  return { type: "unhandled", rawType, data: parsed.data };
}

// --- Idempotency + reconciliation -----------------------------------------

export type WebhookProcessingStatus = "received" | "processed" | "failed";

export interface WebhookEventRecord {
  /** The Svix message id — the idempotency key (Svix redelivers with the same id). */
  id: string;
  type: string;
  receivedAtIso: string;
  status: WebhookProcessingStatus;
}

/**
 * Dedupe store for at-most-once processing. The durable implementation is a
 * Drizzle-backed table (webhook_events) landed with the DB slice; this contract
 * lets the handler be written and tested now.
 */
export interface WebhookDedupeStore {
  has(id: string): boolean | Promise<boolean>;
  mark(record: WebhookEventRecord): void | Promise<void>;
}

/** In-memory dedupe for tests and single-process use. */
export class InMemoryWebhookDedupe implements WebhookDedupeStore {
  private readonly seen = new Map<string, WebhookEventRecord>();

  has(id: string): boolean {
    return this.seen.has(id);
  }

  mark(record: WebhookEventRecord): void {
    this.seen.set(record.id, record);
  }

  get(id: string): WebhookEventRecord | undefined {
    return this.seen.get(id);
  }

  get size(): number {
    return this.seen.size;
  }
}

/**
 * Scheduled reconciliation contract (worker job — credential-blocked). Re-reads
 * authoritative state from Clerk and converges ΛFLO records, covering any
 * webhook lost or processed out of order.
 */
export interface WebhookReconciler {
  reconcile(): Promise<{ checked: number; corrected: number }>;
}
