/**
 * Persistence contracts for the three UN-scoped auth tables (migration 0005):
 * `identity_provider_accounts`, `provider_webhook_events`, `session_revocations`.
 *
 * These are read by the auth resolver BEFORE or ACROSS an org context (a user's
 * identity mapping, their revocations) or for cross-org service work (webhook
 * receipts), so their Neon-backed implementations run on the **resolver
 * connection** (a distinct least-privileged role — migration 0007), NOT under
 * `withOrgContext`. Secrets are digests only (payload/session-id digests), never
 * plaintext.
 *
 * `session_revocations` reads MUST be user-scoped (`WHERE user_id = …`), never a
 * table-wide scan — the ADR-0026/0030 invariant.
 */

import type { WebhookProcessingStatus } from "./webhook";

/** External identity provider (Clerk owns identity in V1). */
export type IdentityProvider = "clerk";

/** A stored `identity_provider_accounts` row: (provider, providerUserId) → afloUserId. */
export interface IdentityProviderAccountRecord {
  id: string;
  provider: IdentityProvider;
  providerUserId: string;
  afloUserId: string;
}

export interface IdentityAccountRepository {
  /** Resolve a provider identity to its AFLO user, or null if unmapped. */
  findByProvider(provider: IdentityProvider, providerUserId: string): Promise<IdentityProviderAccountRecord | null>;
  /**
   * Idempotently link a provider identity to an AFLO user. Unique on
   * `(provider, provider_user_id)`; a repeat link for the same identity is a
   * no-op that returns the existing mapping.
   */
  link(
    provider: IdentityProvider,
    providerUserId: string,
    afloUserId: string,
    now: Date,
  ): Promise<IdentityProviderAccountRecord>;
}

/** A stored `provider_webhook_events` row (idempotency + audit). */
export interface RecordedWebhookEvent {
  id: string;
  provider: IdentityProvider;
  providerEventId: string;
  eventType: string;
  status: WebhookProcessingStatus;
  attempts: number;
}

export interface WebhookReceiptResult {
  /** false when this `(provider, providerEventId)` was already recorded (a redelivery). */
  isNew: boolean;
  record: RecordedWebhookEvent;
}

export interface WebhookEventRepository {
  /**
   * Idempotently record a VERIFIED webhook receipt. Unique on
   * `(provider, provider_event_id)` (the Svix id), so a redelivery returns the
   * existing record with `isNew: false` — the at-most-once processing guard.
   * `payloadDigest` is a sha256 hex; the payload/secret are never stored.
   */
  recordReceipt(
    provider: IdentityProvider,
    providerEventId: string,
    eventType: string,
    payloadDigest: string,
    now: Date,
  ): Promise<WebhookReceiptResult>;
  /** Mark a recorded event processed. */
  markProcessed(id: string, now: Date): Promise<void>;
  /** Mark a recorded event failed (increments attempts, records the error code). */
  markFailed(id: string, now: Date, errorCode: string): Promise<void>;
}

export interface RevokeSessionsInput {
  userId: string;
  /** Optional org scope (null = platform-wide for this user). */
  organizationId?: string | null;
  /** A specific provider session digest, or null/omitted to revoke ALL the user's sessions. */
  providerSessionIdDigest?: string | null;
  reasonCode: string;
  /** Optional expiry after which the revocation no longer applies. */
  expiresAt?: Date | null;
}

export interface SessionRevocationRepository {
  /** Record a revocation (a specific session, or all of the user's sessions). */
  revoke(input: RevokeSessionsInput, now: Date): Promise<void>;
  /**
   * Is a session — issued at `sessionIssuedAt`, with optional `providerSessionIdDigest`
   * — revoked for this user? USER-SCOPED (`WHERE user_id = userId`). A revocation
   * applies when it was recorded AFTER the session was issued
   * (`revoked_at > sessionIssuedAt`), targets this session (digest null = all, or
   * an exact match), and has not expired. Fails closed on a bad timestamp.
   */
  isSessionRevoked(
    userId: string,
    sessionIssuedAt: Date,
    providerSessionIdDigest: string | null,
    now: Date,
  ): Promise<boolean>;
}
