# ADR-0025: RLS per-request tenant context

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive,
PHASE 8 — "RLS request execution")

## Context

Migration 0003 enables Row-Level Security on every tenant table, keyed to the
`app.current_org_id` GUC and hardened to fail closed on an unset/empty value
(ADR — proven on PGlite in `rls-runtime.test.ts`). The remaining question is
*how the app sets that GUC per request*. The directive is explicit:

> For every request: authenticate → verify membership → resolve organization →
> begin transaction → set **transaction-local** `app.current_org_id` → execute →
> commit. **Do not use a global connection-level tenant setting.**

The reason is connection pooling: a `SET` / `set_config(..., false)` at the
session level persists on the physical connection, so the next request that
reuses that pooled connection would inherit the previous request's org — a
cross-tenant leak. A transaction-local setting reverts at COMMIT/ROLLBACK.

## Decision

Add `withOrgContext(db, organizationId, work)` to `@aflo/database`:

- Opens a transaction and sets `app.current_org_id` **transaction-local**
  (`set_config(..., is_local = true)`), then runs `work(tx)` with every query
  RLS-scoped to that organization. The setting reverts when the transaction ends.
- **Fails closed** on an empty organization id (`TenantContextError`) — a
  tenant-scoped request must never reach the DB without a server-resolved org.
  The org id comes from the verified session (ADR-0019), never the browser.
- It is the tenant-scoped path only. Cross-organization paths — the worker
  draining the outbox, the AI-run consumer — connect under an RLS-bypassing role
  (outbox repository docs); platform-admin cross-tenant access is a separate,
  audited surface. The helper is never widened to skip the org set.

## Consequences

- Per-request tenant isolation is provable credential-free: 5 PGlite tests under
  a non-superuser role assert in-transaction scoping, cross-tenant write
  rejection (RLS `WITH CHECK`), fail-closed on empty org — and, the key property,
  that the context **does not leak onto the connection after the transaction**
  (a session-level setting would; this one doesn't) and that two sequential
  transactions each see only their own org.
- **Not yet wired into the web app.** Request handlers still use the mock
  repositories; routing tenant-scoped reads/writes through `withOrgContext` +
  Drizzle repositories on a live connection is the follow-up, gated on the Neon
  `DATABASE_URL` (and a non-superuser runtime role). This ADR delivers the
  wrapper + its isolation proof; the connection + repository swap activates when
  credentials land.
- The wrapper takes a driver-agnostic Drizzle handle, so the same code path
  proven on PGlite runs against Neon in production.
