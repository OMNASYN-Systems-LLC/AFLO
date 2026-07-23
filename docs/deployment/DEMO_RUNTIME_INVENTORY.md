# Demo-Runtime Inventory — the map for the B11 removal slice

Complete inventory of every demo/synthetic runtime surface in ΛFLO (technical:
AFLO). Baselined at the ADR-0048 fail-closed flip and **tightened by ADR-0052
(demo-runtime removal-proper)**: the demo surface is now UNREACHABLE without the
explicit `APP_ENV=demo` opt-in, the demo-marker allowlist is down to one entry,
and the real cell serves zero synthetic bytes (shell included). This is the
working map for the eventual **B11 demo-runtime REMOVAL slice**: everything
listed here either gets deleted, replaced by a persistent implementation, or
explicitly retired when the demo runtime goes away — the credential-gated final
cutover (§h).

Companion documents: `docs/adr/ADR-0052-demo-runtime-removal.md` (this tightening
slice), `docs/adr/ADR-0048-demo-runtime-flip.md` (the decision and truth table),
`docs/adr/ADR-0017-production-runtime-contract.md` (the underlying contract),
`docs/adr/ADR-0021-demo-marker-ci-guard.md` (the static guard),
`AUTH_CUTOVER_RUNBOOK.md` (the activation sequence).

---

## a. Demo markers tracked by the CI guard

`scripts/check-demo-markers.mjs` (root script `pnpm check:demo-markers`,
ADR-0021) scans `apps/*/src` and `packages/*/src` runtime code (tests exempt)
for these markers and fails CI on any hit outside the allowlist:

| Marker (regex) | What it catches |
|---|---|
| `\bDemoAuthProvider\b` | The prototype auth provider class |
| `["'`]demo-user["'`]` | Hardcoded demo user id literal |
| `["'`]demo-client["'`]` | Hardcoded demo client id literal |
| `["'`]portal-demo-client["'`]` | Hardcoded portal client id literal |
| `["'`]mock-session["'`]` | Mock session literal |
| `["'`]synthetic-session["'`]` | Synthetic session literal |
| `["'`]demo-staff["'`]` | Hardcoded demo staff id literal |
| `["'`]demo-org["'`]` | Hardcoded demo org id literal |

Allowlist (the ONLY runtime files that may contain demo identity — **must reach
zero entries when Clerk activates**, and reaches zero in the B11 removal slice).
**ADR-0052 shrank this from two entries to one:** the `DemoAuthProvider` class
AND its construction now live entirely in `packages/auth/src/demo.ts` (the new
`createDemoAuthProvider` factory), so `apps/web/src/lib/data.ts` no longer names
any demo-identity marker and LEFT the allowlist — it is back under full guard
coverage (a re-introduced marker there now fails CI):

| Allowlisted path | Why it exists | Removal condition |
|---|---|---|
| `packages/auth/src/demo.ts` | The `DemoAuthProvider` class + its sole construction factory (`createDemoAuthProvider`) | Clerk-backed provider replaces it (runbook §5.2) — drains the allowlist to zero |

Removed from the allowlist by ADR-0052:

| Formerly allowlisted | Why it is now safe |
|---|---|
| `apps/web/src/lib/data.ts` | The composition root no longer names `DemoAuthProvider` — it calls `createDemoAuthProvider` (a factory whose name carries no marker). The file holds no demo-identity marker, so it needs no allowlist entry and is fully guarded again. |

## b. Runtime-mode resolver call sites

Canonical module: `packages/shared/src/runtime/runtime.ts` (`@aflo/shared`).
Every call site of `resolveAuthMode` / `resolveRepositoryMode` (and the derived
`resolveMessagingUiRuntime` / `isDemoRuntimePermitted`), and which path each
selects after the ADR-0048 flip:

| Call site | What it selects | Path on `clerk+postgres` | Path on explicit demo opt-in | Path on ambiguous config (LOW-5 cells) |
|---|---|---|---|---|
| `packages/shared/src/runtime/runtime.ts` `describeRuntimeReadiness` | The readiness snapshot (`/api/health`) | reports `clerk`/`postgres` | reports `demo`/`memory` | reports `unresolved`/`unresolved` |
| `packages/shared/src/messaging/ui-gateway.ts` `resolveMessagingUiRuntime` | Messaging UI seam runtime | `"persistent"` | `"demo"` | `"unavailable"` (was `"demo"` pre-flip) |
| `apps/web/src/lib/messaging-client.ts` `staffMessaging()` / `portalMessaging()` | Concrete messaging gateways | route-service gateways (`@aflo/database`) | `AfloStore` gateways over demo sessions | route-service gateways with null deps → every op `unavailable` (was store gateways pre-flip) |
| `packages/database/src/services/messaging-routes.ts` `isMessagingRouteConfigured` | The `/api/messages/...` 503 gate | configured when both URLs + `FIELD_ENCRYPTION_KEY` present, else 503 | 503 `not_configured` | 503 `not_configured` (unchanged — already fail-closed) |
| `apps/web/src/app/api/webhooks/clerk/route.ts` | Webhook route 503 gate | active when fully configured | 503 `not_configured` | 503 `not_configured` (unchanged) |
| `apps/web/src/app/api/invitations/route.ts` | Invitation-create route 503 gate | active when fully configured | 503 `not_configured` | 503 `not_configured` (unchanged) |
| `apps/web/src/app/api/invitations/accept/route.ts` | Invitation-accept route 503 gate | active when fully configured | 503 `not_configured` | 503 `not_configured` (unchanged) |
| `apps/web/src/instrumentation.ts` (via `assertRuntimeReady`) | Boot | boots (production additionally requires full ADR-0017 config) | boots | **refuses to start** (new — was "boots into implicit demo" pre-flip) |
| `apps/web/src/lib/data.ts` `assertDemoRuntime` (via `isDemoRuntimePermitted`) | Demo sessions/store/repos | every access throws | serves | every access throws (defense-in-depth behind boot) |

## c. Demo session sources

| Source | File | Identity minted | Consumers |
|---|---|---|---|
| `DemoAuthProvider` (class) + `createDemoAuthProvider` (factory) | `packages/auth/src/demo.ts` | fixed staff or client principal | constructed ONLY inside its own module; `apps/web/src/lib/data.ts` obtains providers via the factory (ADR-0052 — it no longer names the class) |
| `getStaffSession()` | `apps/web/src/lib/data.ts` | org `DEMO_ORG_ID` + staff `DEMO_STAFF.id` (synthetic organization owner) | server actions: `(app)/leads/actions.ts`, `(app)/clients/[clientId]/actions.ts`, `(app)/clients/[clientId]/intake/actions.ts`, `(app)/reviews/actions.ts`; messaging seam demo path (`lib/messaging-client.ts`) |
| `getClientSession()` | `apps/web/src/lib/data.ts` | org `DEMO_ORG_ID` + client `DEMO_CLIENT_ID` (`c-bell`) | `app/portal/page.tsx`; messaging seam demo path (`lib/messaging-client.ts`) |

Both session functions now call `assertDemoRuntime()` first (ADR-0048): outside
the explicit opt-in they throw instead of minting a demo identity. There is no
build-phase bypass — nothing demo-gated executes during `next build` (PR #99
M1).

## d. Synthetic seed entry points

Canonical dataset: `packages/shared/src/data/synthetic.ts` (~1.4k lines —
`syntheticDatabase`, `SYNTHETIC_NOW`, `GOLDEN_KEY_PIPELINE`,
`GOLDEN_KEY_INTAKE`). Consumers in runtime code:

| Consumer | File | Use |
|---|---|---|
| Store default seed | `packages/shared/src/store/store.ts` (`AfloStore` constructor default) | the workflow store hydrates from `syntheticDatabase` by default |
| Mock repositories | `packages/shared/src/repositories/mock.ts` (`MockClientRepository`, `MockDashboardRepository`, `MockPortalRepository` — constructor defaults) | page read models over the synthetic dataset |
| Web composition root | `apps/web/src/lib/data.ts` | instantiates the store + repos from `syntheticDatabase`; pins the read clock to `SYNTHETIC_NOW` (all gated per ADR-0048) |
| Package export | `packages/shared/src/index.ts` | re-exports the dataset (also imported widely by TESTS — exempt) |
| Playbook drafts | `packages/shared/src/data/playbook-seeds.ts` (`GOLDEN_KEY_PLAYBOOK_DRAFTS`) | tenant-IP playbook DRAFT seeds (founder directive 2026-07-20). NOT client PII; the removal slice re-homes these as first-boot editable drafts rather than deleting them |

Note: `SEED_MODE` is now resolved by `resolveSeedMode` as `off` unless the demo
opt-in is active (ADR-0048); nothing materializes synthetic data outside
`APP_ENV=demo`/tests, and the resolvers guarantee it can never resolve
`synthetic` implicitly.

## e. Demo identity surface (rendered identity)

Constants exported by `apps/web/src/lib/data.ts` and rendered by the UI shell:

| Constant | Value | Rendered by |
|---|---|---|
| `DEMO_ORG_ID` | `syntheticDatabase.organization.id` | passed as an ARGUMENT to gated repo/store calls (which throw first outside the opt-in) |
| `DEMO_STAFF` | synthetic organization owner | `(app)/dashboard/page.tsx` (greeting — after a gated `getSnapshot`, so bounded); the `(app)/layout.tsx` shell now reads it ONLY via the gated `getDemoShellIdentity()` accessor (ADR-0052) |
| `DEMO_CLIENT_ID` | `"c-bell"` | `app/portal/page.tsx` (portal persona) |
| `demoNow` | `SYNTHETIC_NOW` | deterministic read clock, passed to the gated repo/store calls; the layout header date now comes through `getDemoShellIdentity()` |
| `getDemoShellIdentity()` (ADR-0052) | `{ staff: DEMO_STAFF, now: demoNow }` behind `assertDemoRuntime()` | `(app)/layout.tsx` — the ONE component that renders identity DIRECTLY (no preceding gated call); the accessor makes it fail closed like the pages |

Files rendering from this surface (all `@/lib/data` importers):
`(app)/layout.tsx`, `(app)/dashboard/page.tsx`, `(app)/clients/page.tsx`,
`(app)/clients/[clientId]/page.tsx`, `(app)/clients/[clientId]/intake/page.tsx`,
`(app)/leads/page.tsx`, `(app)/reviews/page.tsx`, `(app)/reviews/[id]/page.tsx`,
`app/portal/page.tsx`, plus the action modules and `lib/messaging-client.ts`.

**No prerendered synthetic data (PR #99 M1 fix; extended by ADR-0052):** every
data-bearing page is `export const dynamic = "force-dynamic"`, and ADR-0052 adds
the same to `(app)/layout.tsx` (it reads demo identity, so it must not render at
build) — so NOTHING from the demo runtime is baked into a build artifact and
every render passes the ADR-0048 gate at request time. The only prerendered
tokens are the tenant BRAND TITLE ("Golden Key Wealth — powered by AFLO") in the
static `_not-found`/`_global-error` shells — product chrome, never synthetic
client/staff PII.

**Real cell now serves ZERO synthetic bytes — including the shell (ADR-0052).**
On `main`, the `(app)` layout read `DEMO_STAFF`/`demoNow` DIRECTLY (ungated
module constants), with no preceding gated call, so the shell of a real-cell
500 response still streamed synthetic staff identity ("Danielle Mercer",
"Organization Owner", the pinned date) — the LOW-2 ungated-constant leak.
ADR-0052 routes the layout through the gated `getDemoShellIdentity()` (and marks
it `force-dynamic`), so under `clerk+postgres` the layout fails closed too.
Re-verified live: every data page 500s with the refusal AND zero synthetic
tokens in the body, `/api/messages/*` 503; under `APP_ENV=demo` the same pages
serve 200 with the shell identity intact. The `demoGated` store/repository Proxy
was also hardened (ADR-0052): it now gates NON-function property reads too (the
LOW-2 Proxy gap), so a synthetic value can never be read raw outside the opt-in.
No AMBIGUOUS deployment serves anything — boot refuses first.

## f. Truth table — APP_ENV × AUTH_MODE × REPOSITORY_MODE → behavior

The demo opt-in shares the `APP_ENV` axis (`APP_ENV=demo`, ADR-0048), so the
APP_ENV × opt-in × AUTH_MODE × REPOSITORY_MODE table collapses to three axes.
"—" means unset. Exhaustively machine-checked in
`packages/shared/test/runtime.test.ts` ("ADR-0048 truth table").

### Before the flip (the PR #97 LOW-5 hazard, for the record)

| APP_ENV | AUTH_MODE | REPOSITORY_MODE | Pre-flip behavior |
|---|---|---|---|
| — | — | — | **silent demo** (implicit default) |
| — | clerk | — | **silent demo** ← LOW-5: production intent, one variable forgotten |
| — | — | postgres | **silent demo** ← LOW-5 |
| — | clerk | postgres | persistent path; boot permissive |
| preview | clerk | — | **silent demo** ← LOW-5 |
| production | any incomplete | any | boot refuses (ADR-0017 — the only fail-closed cells) |

### After the flip (ADR-0048)

| APP_ENV | AUTH_MODE | REPOSITORY_MODE | Class | Behavior |
|---|---|---|---|---|
| demo | — | — | **demo** | boots; demo sessions + synthetic store/repos + store messaging gateways |
| demo | demo | memory | **demo** | same (explicit demo-family values are legal inside the opt-in) |
| demo | clerk | any | **fail-closed** | boot refuses: contradiction (`APP_ENV=demo` vs real auth) |
| demo | any | postgres | **fail-closed** | boot refuses: contradiction |
| test (or `NODE_ENV=test`) | — | — | **demo permitted (vitest only)** | vitest processes only. A SERVED process in test mode is REFUSED at boot (PR #99 M2): next's CLI only defaults `NODE_ENV` when unset — a pre-set `NODE_ENV=test` survives `next start` — so `instrumentation.register()` (never run by vitest) throws for mode `test` |
| — | — | — | **fail-closed** | boot refuses: `AUTH_MODE`/`REPOSITORY_MODE` unresolved (was silent demo) |
| — | clerk | — | **fail-closed** | boot refuses: `REPOSITORY_MODE` unresolved (LOW-5 cell, closed) |
| — | — | postgres | **fail-closed** | boot refuses: `AUTH_MODE` unresolved (LOW-5 cell, closed) |
| — | demo | memory | **fail-closed** | boot refuses: demo-family values require `APP_ENV=demo` |
| — / development / preview | clerk | postgres | **real** | boots; routes/seam serve 401/503/`unavailable` until full config + Clerk composition — never demo data |
| preview (`VERCEL_ENV=preview`, no APP_ENV) | — | — | **fail-closed** | boot refuses (was silent demo) — intentional demo previews must set `APP_ENV=demo` |
| production | clerk | postgres (+ full ADR-0017 config) | **real (production-ready)** | boots and serves the real runtime |
| production | anything less | | **fail-closed** | boot refuses (ADR-0017, unchanged) |
| any unknown value (e.g. typo) | any | any | **fail-closed** | unknown APP_ENV degrades to development → unresolved axes → boot refuses (a typo can no longer land in demo) |

Every cell lands in exactly ONE of `demo` / `real` / `fail-closed`, and no cell
without the explicit opt-in is `demo`.

## g. Where the explicit opt-in is set (DX / deployment surface)

| Context | Opt-in mechanism | File |
|---|---|---|
| Local `pnpm dev` | committed `APP_ENV=demo` (non-secret; `next dev`-only) | `apps/web/.env.development` (gitignore exception) |
| Playwright e2e | `webServer.env.APP_ENV = "demo"` | `apps/web/playwright.config.ts` |
| `next build` (CI + local + Vercel) | none needed — no page prerenders store data (every data page AND `(app)/layout.tsx` are `force-dynamic`, ADR-0052); the gate has NO build-phase bypass | `apps/web/src/lib/data.ts` + the page modules + `(app)/layout.tsx` |
| Vercel PREVIEW deployments (intentional demo) | **dashboard action required:** set `APP_ENV=demo` for the Preview environment of project `aflo-web` | Vercel dashboard (`DEPLOYMENT.md` §2) |
| Vercel PRODUCTION deployment of the prototype (`main`) | **dashboard action required:** set `APP_ENV=demo` for the Production environment until cutover — without it the prototype deployment refuses to boot after this change | Vercel dashboard (`DEPLOYMENT.md` §2) |
| Unit tests (vitest) | none needed — `NODE_ENV=test` is mode `test` | — |

## h. What the B11 removal slice still owes

**Consolidated by ADR-0052 (removal-proper, this slice):** the demo surface is
now UNREACHABLE without `APP_ENV=demo` — the demo-marker allowlist shrank to one
entry (`packages/auth/src/demo.ts`), the `(app)` shell's synthetic-identity leak
in the real cell is closed (gated `getDemoShellIdentity()` + `force-dynamic`
layout), and the `demoGated` Proxy now fails closed on non-function reads too
(LOW-2). What remains is the CREDENTIAL-GATED final cutover:

1. Replace the demo pages (all dynamic) with persistent-repository
   implementations (runbook §5.5), then delete `apps/web/src/lib/data.ts`
   (including `getDemoShellIdentity` + the identity constants).
2. Replace `getStaffSession`/`getClientSession` with the Clerk-backed provider
   (runbook §5.2) and delete `packages/auth/src/demo.ts` (the class AND the
   `createDemoAuthProvider` factory); this drains the demo-marker allowlist from
   its remaining one entry to **zero**. **(Credential-gated — out of scope for
   ADR-0052.)**
3. Retire the `StoreStaffMessagingGateway`/`StorePortalMessagingGateway` demo
   implementations and the `"demo"` arm of `resolveMessagingUiRuntime` (or
   scope them to tests).
4. Re-home `GOLDEN_KEY_PLAYBOOK_DRAFTS` as first-boot editable tenant drafts.
5. Decide the fate of `APP_ENV=demo` itself: keep as a sales-demo runtime with
   a clearly marked synthetic tenant, or remove the mode entirely and reduce
   the truth table to real/fail-closed.
6. Extend boot enforcement to `apps/worker` when it gains `@aflo/shared`
   (deferred per ADR-0017).
