# ADR-0033: Runtime connection factories + PostgreSQL repository factory (DI seam)

## Status

**Accepted** — 2026-07-22 (founder continuation directive, Workstream B items
1–2: tenant/resolver connection factories + repository factory, built
credential-free)

## Context

The data layer is complete (ADR-0026…0032) but nothing constructs live
connections or composes the repositories for the app. The founder's continuation
directive requires Workstream B (production cutover) to proceed WITHOUT hosted
credentials: all code, dependency injection, test providers, and fail-closed
configuration that can be built credential-free must be built. Connections and
composition are exactly that — the only thing a credential adds is a real URL.

## Decision

### 1. Connection factories (`packages/database/src/connection.ts`)

node-postgres (`pg.Pool`) + `drizzle-orm/node-postgres` — an
**interactive-transaction driver**, which `withOrgContext` requires (`neon-http`
throws on `.transaction()`); Neon's pooled `-pooler` endpoints speak the wire
protocol directly.

- `createTenantConnection(url)` → `ConnectionHandle<TenantScopedDb>` — the
  `aflo_app` pool; every query goes through `withOrgContext`.
- `createResolverConnection(url)` → `ConnectionHandle<ResolverDb>` — the
  `aflo_auth_resolver` pool (ADR-0030/0031), used only by the resolver-path
  repositories and the accept-by-token resolve.
- `createRuntimeConnections(env)` → both, from a **fail-closed validated**
  environment (`getDatabaseConfig` with `requireResolverUrl: true`) — a missing
  or malformed URL throws `DatabaseConfigError` BEFORE any pool exists.

The key property making this credential-free-testable: **pg.Pool is lazy** —
construction performs no I/O; the first query opens the first socket. Tests
prove construction against a guaranteed-unreachable TEST-NET-1 host neither
connects (`totalCount === 0`) nor throws, `close()` resolves on a never-used
pool, and the handles expose the interactive-transaction API.

### 2. Config extension (`AUTH_RESOLVER_DATABASE_URL`)

`DatabaseConfig` gains `resolverUrl` with the same validate-when-required-or-
provided rule as `DIRECT_DATABASE_URL`, aggregated into the one
`DatabaseConfigError`; `isResolverConfigured` joins `isDatabaseConfigured` as
the non-throwing probe. The cutover runbook's env-var table already names this
variable.

### 3. Repository factory (`packages/database/src/repositories/factory.ts`)

`createRepositories({ tenantDb, resolverDb, cipher })` → every Drizzle
repository plus the pre-bound `acceptInvitation` orchestration. This is the
**dependency-injection seam**: the web app's composition root depends on this
one function, and tests inject PGlite handles + an ephemeral cipher through the
exact same seam production uses. The handle split encodes the ADR-0030/0031
privilege boundary — org-scoped repos get `tenantDb`, resolver repos get
`resolverDb`, and `acceptInvitation` is pre-bound to both so callers cannot
swap the connections. Construction is pure — no connection is opened.

## Consequences

- **Proven credential-free**: `connection.test.ts` (5 — laziness, clean close,
  interactive-tx API, fail-closed on missing/malformed URLs before any pool) and
  `repository-factory.test.ts` (3 — the full activation loop THROUGH the factory
  output on PGlite: issue → accept-by-token → membership; resolver repos wired;
  encrypted messaging round-trip with the injected cipher), plus 5 new config
  tests. **172 database tests total**; workspace typecheck/lint + web build +
  demo-guard green. `pg`/`@types/pg` added to `@aflo/database` (server-only —
  never client-bundled).
- **What a credential changes**: nothing structural. The boot path becomes
  `createRuntimeConnections(process.env)` + `parseFieldEncryptionKey(...)` +
  `createRepositories(...)` — three already-tested calls.
- **Next Workstream B slices**: the Clerk provider adapter (B3), webhook route
  (B4), and principal resolution (B5) consume this seam; the boot fail-closed
  contract (ADR-0017) extends to require the resolver URL + field key when the
  authenticated runtime activates.
