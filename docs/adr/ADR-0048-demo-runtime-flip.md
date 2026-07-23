# ADR-0048: Demo runtime becomes an explicit opt-in (`APP_ENV=demo`); ambiguous configs fail closed

## Status

**Accepted** — 2026-07-23 (Workstream B11 prep; closes PR #97 review finding
LOW-5)

## Context

ADR-0017 made **production** an explicit opt-in (`APP_ENV=production`) and
fail-closed, but left the **demo/synthetic runtime as the implicit default**
everywhere else: `resolveAuthMode` defaulted to `demo`, `resolveRepositoryMode`
to `memory`, `resolveSeedMode` to `synthetic`, and `resolveRuntimeConfig` was
"permissive outside production".

PR #97's review named the resulting hazard (LOW-5): a deployment that INTENDS
production but omits `APP_ENV=production` AND one of
`AUTH_MODE`/`REPOSITORY_MODE` resolves to mode `development`/`preview`, passes
boot, and **silently serves synthetic data with demo identities** — e.g.
`AUTH_MODE=clerk` alone landed the messaging seam on the demo store path. A
typo'd `APP_ENV` value degraded the same way.

The founder directive is non-negotiable: outside automated tests, ΛFLO must
never silently fall back to demo identities or synthetic data.

## Decision

**Make the demo/synthetic runtime symmetric with production: entered only by an
explicit `APP_ENV=demo`.** No new flag system — `APP_ENV` was already the
single deliberate-intent axis of the ADR-0017 contract ("production is only
ever entered by an explicit APP_ENV=production"); this adds ONE value to that
same axis. `AUTH_MODE`/`REPOSITORY_MODE`/`SEED_MODE` keep their exact meanings;
they only lose their unsafe demo DEFAULTS.

Mechanics (all in `packages/shared/src/runtime/runtime.ts`):

1. `RUNTIME_MODES` gains `demo`. `isDemoRuntimePermitted(env)` is true only for
   mode `demo` (explicit) and mode `test` (vitest sets `NODE_ENV=test`; no
   hosted deployment runs with it — `next build`/`next start` force
   `NODE_ENV=production`).
2. `AuthMode`/`RepositoryMode` gain `"unresolved"`. The resolvers return the
   demo-family value ONLY under `isDemoRuntimePermitted`; with no explicit real
   selection and no opt-in they return `"unresolved"`, so every consumer
   comparing `=== "clerk"` / `=== "postgres"` stays on its fail-closed path and
   nothing matching `=== "demo"` / `=== "memory"` can fire. `resolveSeedMode`
   resolves `synthetic` only under the opt-in — absence never implies synthetic
   (in production this also means an UNSET `SEED_MODE` is now valid; an
   explicit `SEED_MODE=synthetic` still fails).
3. `resolveRuntimeConfig` (and therefore `assertRuntimeReady` +
   `instrumentation.ts` boot enforcement) rejects:
   - development/preview with any unresolved axis (the LOW-5 cells — including
     the empty env and unknown/typo'd `APP_ENV` values, which degrade to
     development);
   - demo-family values (`AUTH_MODE=demo`, `REPOSITORY_MODE=memory`,
     `SEED_MODE=synthetic`) outside the opt-in;
   - contradictions inside the opt-in (`APP_ENV=demo` + `AUTH_MODE=clerk` or
     `REPOSITORY_MODE=postgres`) — the demo runtime never mixes with real
     providers, and a real selection is never silently downgraded to demo.
   Production checks are unchanged (ADR-0017). Test mode stays permissive.
4. `resolveMessagingUiRuntime` (ADR-0046 seam) becomes three-valued:
   `persistent` (clerk+postgres) / `demo` (opt-in only) / `unavailable`
   (everything else). `apps/web/src/lib/messaging-client.ts` routes
   `unavailable` through the route-service gateways with null deps, so every
   operation answers the 503-shaped `unavailable` — never demo data.
5. `apps/web/src/lib/data.ts` (the demo composition root) gates every exported
   session, store, and repository access on `isDemoRuntimePermitted` — outside
   the opt-in each access throws (defense-in-depth behind boot). The one
   allowance: `next build` prerender (`NEXT_PHASE=phase-production-build`), so
   the prototype's static shell can build without an env var; SERVING always
   passes boot + this gate first.

## The truth table

`—` = unset; exhaustively machine-checked in
`packages/shared/test/runtime.test.ts` (full prose table:
`docs/deployment/DEMO_RUNTIME_INVENTORY.md` §f).

| APP_ENV | AUTH_MODE | REPOSITORY_MODE | Class |
|---|---|---|---|
| demo | —/demo | —/memory | **demo** (boots, serves synthetic) |
| demo | clerk | any | **fail-closed** (boot refuses: contradiction) |
| demo | any | postgres | **fail-closed** (boot refuses: contradiction) |
| test / `NODE_ENV=test` | any | any | **demo permitted** (automated tests only) |
| —/development/preview | — | — | **fail-closed** (was silent demo) |
| —/development/preview | clerk | — | **fail-closed** (LOW-5 cell, closed) |
| —/development/preview | — | postgres | **fail-closed** (LOW-5 cell, closed) |
| —/development/preview | demo | memory | **fail-closed** (demo-family without opt-in) |
| —/development/preview | clerk | postgres | **real** (boots; serves 401/503/`unavailable` until fully configured — never demo) |
| production | clerk | postgres + full ADR-0017 config | **real, production-ready** |
| production | anything less | | **fail-closed** (ADR-0017, unchanged) |
| unknown value (typo) | any | any | **fail-closed** (degrades to development → unresolved axes) |

Every cell lands in exactly one class; **no cell without the explicit opt-in is
demo**. Verified live: `next start` with no opt-in → "Failed to prepare
server", all requests 500; with `APP_ENV=demo` → demo serves; with
clerk+postgres only → boots, dynamic pages/actions 500 with the refusal error,
`/api/messages/*` 503, static shell pages serve baked HTML (owed to the removal
slice — inventory §e).

## Why this is ADR-0017-consistent

- ADR-0017's own design principle — "going live is a deliberate act
  (`APP_ENV=production`)" — is extended, not replaced: running demo is now a
  deliberate act too, on the same variable.
- No parallel flag: the existing `AUTH_MODE`/`REPOSITORY_MODE`/`SEED_MODE`
  vocabulary is unchanged; `resolveMessagingUiRuntime` (ADR-0046) still derives
  from the same two resolvers.
- ADR-0017's constraint "the live prototype must not break" becomes "the live
  prototype must OPT IN": the Vercel `aflo-web` project needs `APP_ENV=demo`
  set for Production and Preview environments before/when this merges
  (`DEPLOYMENT.md` §2). That dashboard action is the entire migration.

## DX / deployment impact

| Context | Change |
|---|---|
| `pnpm dev` | unchanged UX — committed `apps/web/.env.development` (`APP_ENV=demo`, non-secret, `next dev`-only; gitignore exception) |
| `pnpm --filter @aflo/web build` | unchanged — prerender allowance, no env needed |
| Playwright | `playwright.config.ts` webServer env sets `APP_ENV=demo` |
| Local `next start` smoke runs | now require `APP_ENV=demo pnpm --filter @aflo/web start` |
| Vercel preview + prototype production | dashboard must set `APP_ENV=demo` (until real cutover flips each env to its real config) |
| Unit tests | unchanged (`NODE_ENV=test`) |

## What the final demo-REMOVAL slice (B11) still owes

See `docs/deployment/DEMO_RUNTIME_INVENTORY.md` §h: replace/delete the demo
pages and `lib/data.ts` (including the `NEXT_PHASE` allowance), swap in Clerk
sessions and drain the demo-marker allowlist to zero, retire the store
messaging gateways and the seam's `demo` arm, re-home the playbook draft seeds,
decide whether `APP_ENV=demo` survives as a marked sales-demo runtime, and
extend boot enforcement to the worker.

## Alternatives considered

1. **A dedicated variable (`DEMO_RUNTIME=1`).** Rejected: creates a second
   intent axis beside `APP_ENV` and a second way to say "demo" beside
   `AUTH_MODE=demo` — exactly the parallel flag system ADR-0017 avoids.
2. **Treat explicit `AUTH_MODE=demo` + `REPOSITORY_MODE=memory` as the opt-in.**
   Rejected: two-variable opt-ins reintroduce ambiguous partial cells (one set,
   one forgotten) — the hazard this ADR closes. One signal, one axis.
3. **Flip the resolver defaults to `clerk`/`postgres`.** Rejected: an env with
   real URLs but no explicit mode selection would silently ACTIVATE the
   persistent composition — the mirror image of LOW-5 ("no credential
   activation" is a hard constraint of this slice).
4. **Fail closed only at the seams (no boot change).** Rejected: boot
   enforcement is the only layer that also covers statically prerendered pages
   and future unseamed surfaces; runtime guards remain as defense-in-depth.
