# ADR-0017: Production runtime fail-closed contract

## Status

**Accepted** — 2026-07-19 (production-conversion directive, Phase 2 —
"Production Runtime Contract")

## Context

The founder's production-conversion directive sets a **non-negotiable** rule:
outside test mode, ΛFLO must **never silently fall back** to demo identities,
mock repositories, in-memory state, synthetic data, mock delivery, public
document storage, a preview database, or an ephemeral production signing key.
Production must **fail closed** when required configuration is missing.

Today the app runs entirely on the safe-for-development defaults (demo auth,
in-memory store, synthetic seed). When real credentials arrive, we need a single
contract that (a) decides which providers are allowed in each mode and (b)
refuses to run a production process that is misconfigured — *before* a user ever
hits a demo/mock path.

Two constraints shaped the design:

1. **The live prototype must not break.** `apps/web`'s `main` branch deploys to
   Vercel "production" today, running the prototype defaults. A contract that
   inferred "production" from a hosting signal (`VERCEL_ENV=production`) and
   failed closed would take that deployment down immediately.
2. **No new cross-package cycle.** `@aflo/database` already depends on
   `@aflo/shared`, so the contract cannot live in `@aflo/shared` and import
   `@aflo/database`'s config. `@aflo/config` is a build-preset package
   (eslint/tsconfig bases referenced by path), not an importable runtime module.

## Decision

- Ship a **pure, self-contained runtime contract** at
  `packages/shared/src/runtime/runtime.ts` (exported from `@aflo/shared`, so both
  the web app and the Railway worker import one contract). It reads only an
  env-like map and returns a verdict; it opens no connection and holds no secret.
  Deep validation of any one integration (e.g. the Neon two-URL parse) stays in
  that integration's own config (`@aflo/database` `getDatabaseConfig`) — this is
  the lighter, broader **boot gate**.

- **`resolveRuntimeMode(env)`** — `test | development | preview | production`.
  **Production is only ever entered by an explicit `APP_ENV=production`.** It is
  never inferred from `VERCEL_ENV` or `NODE_ENV`, so the prototype deployment
  cannot silently become "production" and fail closed. Going live is a
  deliberate act (set `APP_ENV=production`).

- **`resolveRuntimeConfig(env)`** — permissive outside production; in production
  it fails closed, accumulating a `problem` for every forbidden fallback
  (demo auth, mock/in-memory repos, synthetic seed, mock email, public storage)
  and every missing required integration (both database URLs, a non-preview
  branch, Clerk keys, private storage, encryption-key reference, worker secret,
  Sentry DSNs). `ok` is true only when the list is empty.

- **`assertRuntimeReady(env)`** — the fail-closed boot gate: returns the config
  or throws `RuntimeConfigError` (aggregated problems). Intended to be called at
  process startup.

- **`describeRuntimeReadiness(env)`** + **`GET /api/health`** — a non-secret
  readiness snapshot (runtime mode + a boolean per integration + the selected
  provider modes). It reports; it never exposes a secret value.

## Follow-ups (status)

- **Boot-time enforcement — LANDED for web.** `apps/web/src/instrumentation.ts`
  `register()` calls `assertRuntimeReady(process.env)` on server startup (Node.js
  runtime only). Verified end-to-end: with `APP_ENV=production` and nothing
  configured, `register()` throws, Next.js fails to prepare the server, and every
  request returns HTTP 500 — the app refuses to serve rather than silently
  running on demo/mock. With `APP_ENV` unset (the prototype) it resolves to
  `development`, never throws, and boots normally (all e2e pass).
- **Boot-time enforcement — DEFERRED for the worker.** `apps/worker` is a no-op
  stub with no dependencies that builds via plain `tsc → node dist`; it cannot
  import the TypeScript-source contract without a JS build story, and its real
  operation is credential-blocked. Worker boot enforcement folds into the
  worker's real-operation slice (when it gains `@aflo/shared` + durable jobs).
- **Preview-branch detection — STRENGTHENED.** An explicit `DATABASE_BRANCH` is
  now the authoritative signal (`isPreviewDatabase`): `DATABASE_BRANCH=preview`
  is rejected in production even when the Neon host string is opaque, and
  `DATABASE_BRANCH=main` overrides a preview-looking URL (no false positive). The
  URL substring heuristic remains the fallback when `DATABASE_BRANCH` is unset.
- **`migration current`** is still not reported (needs a live DB connection —
  credential-blocked).

## Alternatives Considered

1. **Infer production from `VERCEL_ENV=production`.** Rejected — it would fail
   closed on the current live prototype deployment. Explicit `APP_ENV` opt-in is
   both safer and what the directive's variable list implies (`APP_ENV=production`).
2. **Stand up `@aflo/config` (or a new `@aflo/runtime`) as the home.** Rejected
   for now — `@aflo/config` is a build-preset package with no runtime build set
   up, and a new package adds infra for no second consumer yet. `@aflo/shared` is
   already imported by both apps and needs no new setup. Relocation is a cheap
   import-path change if a dedicated package is ever warranted.
3. **Import `@aflo/database`'s `isDatabaseConfigured` into the contract.**
   Rejected — it would pull the Drizzle runtime into the contract and (were the
   contract in `@aflo/shared`) risk a dependency cycle. A light presence check
   here + the deep parse at connect time is cleaner and correctly layered.
