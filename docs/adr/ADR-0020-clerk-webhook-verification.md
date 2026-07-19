# ADR-0020: Clerk (Svix) webhook signature verification

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive,
PHASE 3 — "Clerk synchronization")

## Context

Clerk owns authentication; ΛFLO owns organization, membership, role, client
link, and account status (ADR-0019). Keeping ΛFLO's records in sync with Clerk
requires consuming Clerk's webhooks — `user.*`, `organization.*`,
`organizationMembership.*`. The directive is explicit: **do not process unsigned
webhooks**, verify signatures, be idempotent, tolerate duplicates and
out-of-order delivery, and reconcile on a schedule.

Clerk delivers via **Svix**, whose signature scheme is a symmetric HMAC over
`${svix-id}.${svix-timestamp}.${rawBody}` with the base64-decoded signing secret
(after the `whsec_` prefix). This is verifiable with `node:crypto` alone — no new
dependency, and pure/credential-free given a secret + payload, so it can be built
and exhaustively tested now, before the real `CLERK_WEBHOOK_SECRET` exists.

## Decision

Add `@aflo/auth/webhook` (a **subpath export**, not the package barrel):

- **`verifyWebhook({ payload, headers, secret, toleranceSeconds?, nowSeconds? })`**
  — recomputes the Svix HMAC and constant-time-compares (`timingSafeEqual`)
  against each `v1` signature in the `svix-signature` header. Fails closed with a
  stable `WebhookVerificationError.reason`: `missing_headers`, `malformed_secret`,
  `invalid_timestamp`, `timestamp_out_of_tolerance` (default ±300s),
  `no_signatures`, `signature_mismatch`. `nowSeconds` is injectable for
  deterministic timestamp tests. Errors never carry the secret or payload.
- **`parseWebhookEvent`** → a typed `WebhookEvent` discriminated union over the
  eight handled types; an unknown type becomes `{ type: "unhandled", rawType }`
  (ignored, never thrown).
- **Idempotency**: `WebhookEventRecord` keyed by the Svix message id +
  `WebhookDedupeStore` interface + `InMemoryWebhookDedupe`. Svix redelivers with
  the same id, so the id is the idempotency key. The durable table
  (`webhook_events`, Drizzle) lands with the DB slice.
- **`WebhookReconciler`** interface — the scheduled worker job stub that re-reads
  authoritative Clerk state (credential-blocked).

### Why a subpath, not the barrel

`webhook.ts` imports `node:crypto`. If it were re-exported from `index.ts`, a
future **client** component importing `@aflo/auth` could pull `node:crypto` into
the browser bundle and break the build. The subpath (`@aflo/auth/webhook`) keeps
crypto strictly server-side; `@aflo/auth` needs `@types/node` + `"types":
["node"]` (matching `packages/security`).

## Consequences

- The signature-verification core is complete and tested (12 webhook tests:
  genuine signature accepted, within/out-of-tolerance timestamps, tampered body,
  wrong secret, missing headers, no `v1` signature, malformed secret,
  multi-signature, every event type parsed, unknown→unhandled, idempotent
  replay).
- **Not yet wired.** The webhook **route** (`app/api/webhooks/clerk`), which reads
  the raw body, calls `verifyWebhook`, dedupes, applies the sync to ΛFLO records,
  and writes an audit event, is a later slice — gated on the Clerk secret + the
  Drizzle `webhook_events` table. This ADR delivers verification + the contracts
  the route will consume.
- Verification is over the **raw** request body; the route must read the raw
  bytes before any JSON middleware reparses/reserializes them, or signatures
  will not match. Documented for the wiring slice.
