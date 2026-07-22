# ADR-0039: Clerk webhook route (Workstream B4)

## Status

**Accepted** — 2026-07-22 (founder continuation directive 2026-07-22,
Workstream B item 4)

## Context

The Svix-style verifier (ADR-0020, PR #69) and the idempotent
`WebhookEventRepository` (ADR-0031) existed unwired. The route that receives
Clerk's webhooks is the last identity-plumbing piece before credential-gated
activation — and it must be built credential-free, fail-closed, with the
payload never stored raw.

## Decision

**`handleClerkWebhook(deps, request)`** (`@aflo/database/services/clerk-webhook.ts`)
— the tested core; the route injects a pre-bound verifier + resolver-path
repositories + clock. Order of operations is the security contract:

1. **Verify FIRST.** An unverified payload is never persisted — not even a
   digest. Failures → 401 with the verifier's stable reason.
2. **Record idempotently** on `(provider, svix id)` with a sha256 payload
   DIGEST only. A redelivery of a PROCESSED event → 200 no-op
   (at-most-once success); a redelivery of a FAILED/unfinished event is
   **re-processed** — failures stay retryable or Svix redelivery is useless.
3. **Dispatch narrowly** (Clerk is the IDENTITY authority, nothing more):
   `user.deleted` → if mapped, revoke ALL that user's sessions (provider-side
   deletion fails closed immediately); `user.created`/`user.updated` →
   recorded, NO writes — ΛFLO users are provisioned via the invitation flow
   (identity-claiming invariant, ADR-0022), so a webhook never creates or
   mutates user rows; `organization*`/`organizationMembership.*` → recorded,
   NO writes — membership authority is ΛFLO's `organization_members`;
   unhandled types → recorded, ignored. Then `markProcessed` /
   `markFailed(errorCode)`.

**`POST /api/webhooks/clerk`** (`apps/web/.../route.ts`) — a THIN composition:
fails closed 503 (nothing processed, nothing persisted) unless
`AUTH_MODE=clerk`, `REPOSITORY_MODE=postgres`, `CLERK_WEBHOOK_SECRET` present,
and the resolver URL configured — the demo/synthetic runtime NEVER processes
provider webhooks. Builds ONLY resolver-side repositories on a module-scoped
lazy connection (no tenant handle, no field cipher — the brand types make a
handle swap unrepresentable); reads the raw body exactly once for
byte-accurate signature verification; secrets never appear in responses.

## Consequences

- **9 new tests → 207 database tests**: 401-with-nothing-persisted, digest
  fidelity (sha256 of the exact raw payload), processed-redelivery no-op,
  failed-redelivery RE-processing with error-code capture, session revocation
  on mapped `user.deleted` (all-sessions, system-initiated), unmapped-identity
  ignore, no-write proofs for user/org/membership events, unhandled-type
  tolerance.
- apps/web now depends on `@aflo/database` (server-only route usage; the web
  build stays green — nothing database-flavored is client-bundled).
- Credential-gated remainder: setting the env (Clerk secret + resolver URL) in
  Vercel and pointing Clerk's webhook endpoint at the route. Profile-sync on
  `user.updated`, if ever wanted, is a founder-gated later slice.
