# ADR-0031: Resolver-path repositories (identity accounts, webhook events, session revocations)

## Status

**Accepted** — 2026-07-20 (Production Cutover directive, PHASE 5 resolver half —
the repositories over the un-scoped tables; builds on ADR-0030's grant matrix)

## Context

Migration 0007 (ADR-0030) established the resolver privilege boundary — a
least-privileged `aflo_auth_resolver` role that is the sole reader/writer of the
three un-scoped auth tables. This slice adds the repositories that run on that
resolver connection, so the identity-resolution, webhook-idempotency, and
session-revocation reads/writes have a durable, tested home. Unlike the messaging
and invitation repositories (ADR-0028/0029), these do **not** use
`withOrgContext`: the rows are read before or across an org context, and the
tables carry no org-RLS.

## Decision

Add to `@aflo/auth` the three resolver contracts (co-located in
`resolver-repositories.ts`) and implement them in `@aflo/database`
(`repositories/resolver.ts`) as plain Drizzle repositories over a `ResolverDb`
handle (the resolver connection). No `withOrgContext`.

- **`IdentityAccountRepository`** — `findByProvider(provider, providerUserId)` →
  the AFLO user, and `link(...)` which is **idempotent** on
  `(provider, provider_user_id)` (a repeat link returns the existing mapping via
  `ON CONFLICT DO NOTHING` + read-back), so re-processing a Clerk `user.created`
  is safe.
- **`WebhookEventRepository`** — `recordReceipt(...)` is **idempotent** on
  `(provider, provider_event_id)` (the Svix id): a redelivery returns the existing
  record with `isNew: false`, the at-most-once processing guard. `payloadDigest`
  is a sha256 hex — the payload/secret are never stored. `markProcessed` /
  `markFailed` (which increments `attempts` + records `last_error_code`) drive the
  receipt lifecycle.
- **`SessionRevocationRepository`** — `revoke(...)` records a revocation (a
  specific session digest, or all of the user's sessions when the digest is
  null). `isSessionRevoked(...)` is the **user-scoped** read the ADR-0026/0030
  invariant requires (`WHERE user_id = …`, never a table-wide scan): a session is
  revoked when a revocation was recorded *after* it was issued
  (`revoked_at > sessionIssuedAt`), targets it (null digest = all sessions, or an
  exact digest match), and has not expired.

The resolver contracts live in `@aflo/auth` (leaf), so the existing
`database → auth` edge (ADR-0029) carries them with no new cycle. The
`WebhookProcessingStatus` type is referenced via indexed access
(`RecordedWebhookEvent["status"]`) so `@aflo/database` needs no import from the
server-only `@aflo/auth/webhook` subpath.

## Consequences

- **Proven credential-free on PGlite under the `aflo_auth_resolver` role**
  (`resolver-repository.test.ts`, 11 tests): idempotent identity link + resolve +
  unknown-null; idempotent webhook receipt (redelivery → `isNew:false`) +
  processed/failed transitions; and the full session-revocation semantics —
  revoke-all (before-cutoff revoked, later spared), digest-specific targeting,
  expiry, and **user-scoping** (revoking user A does not revoke user B). **151
  database tests total**; workspace typecheck/lint + web build + demo-guard green.
- **Not yet wired.** The resolver connection is opened under `aflo_auth_resolver`
  on a live Neon URL — credential-gated. Until then these repositories are
  proven-but-unwired, exactly like the org-scoped ones.
- **Next slice — accept-by-token orchestration.** The workflow that ties this
  together: resolve the invitation via `find_invitation_by_token` (ADR-0030) →
  `acceptInvitation` (kernel) → `applyAcceptedBinding` → create the
  `client_user_link` (client) or `organization_members` row (staff) → mark the
  invitation accepted, spanning the resolver read and the org-scoped writes. Plus
  the webhook route (verify → `recordReceipt` → reconcile) and the session-context
  wiring that consults `isSessionRevoked`.
