# ADR-0052: Demo-runtime removal-proper — the demo surface is unreachable without `APP_ENV=demo`, and the marker allowlist shrinks to one

## Status

**Accepted** — 2026-07-23 (Workstream B11 — demo-runtime removal-proper;
follow-up to ADR-0048)

## Context

ADR-0048 made the demo/synthetic runtime an **explicit opt-in** (`APP_ENV=demo`)
and made ambiguous/production-intended configs **fail closed at boot**. It also
produced `docs/deployment/DEMO_RUNTIME_INVENTORY.md` — the complete map of the
demo surface — and named the follow-up work (inventory §h): tighten the surface
so the demo session sources and the synthetic store are reachable ONLY behind
the opt-in, and shrink the `check:demo-markers` allowlist to match.

This ADR is that removal-proper follow-up. It is a **hardening/consolidation**
slice, NOT a rewrite and NOT a credential activation: the demo runtime stays
(previews need it behind `APP_ENV=demo`); the goal is that it is UNREACHABLE
without the opt-in, not gone. Replacing the demo sessions with the real
Clerk-backed provider is credential-gated and remains out of scope (§h item 2).

Walking the inventory against the live real-runtime cell (`clerk+postgres`,
which boots) surfaced three gaps the ADR-0048 flip had left:

1. **A second demo-marker home.** The `DemoAuthProvider` marker lived in two
   allowlisted files — the class in `packages/auth/src/demo.ts` and its
   construction in `apps/web/src/lib/data.ts`. The allowlist could not shrink
   while the web composition root named the class directly.
2. **The `demoGated` Proxy's LOW-2 gap.** The composition root's Proxy gated
   only FUNCTION-valued properties (asserting on call). A non-function property
   read — e.g. an accessor/getter returning synthetic state — was returned RAW,
   without the gate, so a synthetic value could be read outside the opt-in
   without a method call.
3. **A live synthetic-identity leak in the real cell (LOW-2, worse than
   documented).** The inventory claimed the real cell serves "zero synthetic
   bytes." It did not, in the shell: `(app)/layout.tsx` read the UNGATED module
   constants `DEMO_STAFF`/`demoNow` and rendered them DIRECTLY (sidebar name +
   role, header date), with no preceding gated call to throw first. So under
   `clerk+postgres` a data-page request 500'd — but its streamed RSC payload
   still contained the layout shell with "Danielle Mercer", "Organization
   Owner", and the pinned date. Every DATA page renders synthetic values only
   THROUGH a gated store/repository call (which throws first), so the layout was
   the one unbounded exception.

## Decision

Tighten the three gaps; preserve the ADR-0048 fail-closed posture exactly.

1. **Consolidate `DemoAuthProvider` into one file; shrink the allowlist 2 → 1.**
   `packages/auth/src/demo.ts` gains `createDemoAuthProvider(session)` — the ONLY
   construction of the class outside its own definition. `apps/web/src/lib/data.ts`
   calls the factory instead of `new DemoAuthProvider(...)`, so it no longer
   names any demo-identity marker and LEFT the `check:demo-markers` allowlist.
   The factory name carries no `\bDemoAuthProvider\b` marker (no word boundary
   after `create`). The allowlist is now a single entry — `packages/auth/src/demo.ts`
   — the class + its sole factory, the one legitimate demo-only home, which
   drains to zero when Clerk replaces it (runbook §5.2). `data.ts` is back under
   FULL guard coverage: a re-introduced marker there now fails CI.

2. **Harden the `demoGated` Proxy for non-function reads (LOW-2).** The `get`
   trap now calls `assertDemoRuntime()` before returning ANY non-function
   property (functions stay gated on CALL, as before, so a reference read stays
   cheap and the throw lands where the synthetic work runs). No consumer reads a
   data property off these singletons today — every call site uses a method — so
   this only strengthens the fail-closed posture and never changes demo/test
   behavior.

3. **Gate the `(app)` shell's identity; make the layout `force-dynamic`.** A new
   gated accessor `getDemoShellIdentity()` (in `lib/data.ts`) returns
   `{ staff: DEMO_STAFF, now: demoNow }` behind `assertDemoRuntime()`.
   `(app)/layout.tsx` reads its sidebar identity + header date ONLY through it,
   so outside the opt-in the layout fails closed exactly like the pages — no
   synthetic identity is served in the real cell's shell. Because the layout now
   reads demo identity through a throwing accessor, it must not render at BUILD
   time (no opt-in there), so it gains `export const dynamic = "force-dynamic"`
   — the same PR #99 M1 principle already applied to every data page. Under
   `APP_ENV=demo` the accessor is a pass-through and the shell renders
   byte-identically, so demo previews are unchanged. `DEMO_STAFF`/`demoNow`/`DEMO_ORG_ID`
   remain exported for pages that pass the id/clock as ARGUMENTS to gated
   store/repository calls (which throw first); the dashboard greeting's
   `DEMO_STAFF` read is bounded by its preceding gated `getSnapshot`.

Nothing else changes: `packages/shared/src/runtime/runtime.ts` (the resolvers
and the truth table), `instrumentation.ts` (the boot gate, incl. the test-mode
serve refusal), and the ADR-0048 truth table are untouched. No new env flag —
the ADR-0017/0048 `APP_ENV` contract is unchanged.

## The shrunk allowlist

| Allowlisted path (after ADR-0052) | Why it is still legitimate |
|---|---|
| `packages/auth/src/demo.ts` | The `DemoAuthProvider` class + `createDemoAuthProvider` — genuinely demo-only, drains to zero at the Clerk swap |

Removed: `apps/web/src/lib/data.ts` — no longer contains any demo-identity
marker (it calls the factory). Its removal is evidence the marker no longer sits
in that production path, and restores guard coverage over the file.

## What is preserved (verified)

- **ADR-0048 fail-closed boot posture** — ambiguous dev/preview configs refuse
  to boot; a served process in test mode is refused; unchanged resolvers/truth
  table. Live: a no-opt-in `next start` → `RuntimeConfigError` at the
  instrumentation hook, serves nothing.
- **Zero synthetic bytes in build artifacts** — every data page AND the `(app)`
  layout are `force-dynamic`; `pnpm --filter @aflo/web build` needs no env; the
  only prerendered token is the tenant brand title in the static
  `_not-found`/`_global-error` shells (product chrome, not PII).
- **Real cell serves zero synthetic bytes — now including the shell.** Live
  re-verification under `clerk+postgres`: `/`, `/dashboard`, `/clients`,
  `/leads`, `/reviews`, `/portal` all fail closed (500 with the refusal and NO
  synthetic tokens in the body), `/api/messages/*` → 503.
- **Demo previews** — under `APP_ENV=demo` the same pages serve 200 with the
  shell identity intact; the full Playwright suite (62 specs) passes under the
  opt-in.
- **`pnpm dev` DX** — the committed `apps/web/.env.development` (`APP_ENV=demo`)
  and the Playwright webServer opt-in are untouched.

## What remains for the credential-gated final cutover (out of scope here)

Inventory §h: replace the demo pages + delete `lib/data.ts` (incl.
`getDemoShellIdentity`), swap `getStaffSession`/`getClientSession` for the
Clerk-backed provider and delete `packages/auth/src/demo.ts` (draining the
allowlist to **zero**), retire the store messaging gateways + the seam's `demo`
arm, re-home the playbook draft seeds, decide the fate of `APP_ENV=demo`, and
extend boot enforcement to the worker. Item 2 (real auth) is credential-gated
and explicitly deferred.

## Alternatives considered

1. **Leave `data.ts` allowlisted and just document it.** Rejected: the slice's
   mandate is to SHRINK the allowlist to the minimum still-legitimate set. Once
   the factory removes the marker, keeping the entry is stale and blinds the
   guard to a real production file.
2. **Fully lazify `DEMO_STAFF`/`DEMO_ORG_ID`/`demoNow` into gated accessors.**
   Rejected as a rewrite: it ripples into ~8 consumer modules and risks the
   pass-as-argument pattern. The id/clock constants are only ever passed to
   already-gated calls; the ONE component that renders identity directly (the
   layout) is gated instead — necessary and sufficient to close the leak.
3. **Gate the Proxy's non-function reads only if a data prop exists today.**
   Rejected: the point of defense-in-depth is to fail closed for a FUTURE
   accessor too; the check is free in the demo/test path (a no-op).
4. **A build-time env to keep the layout static.** Rejected: it would
   reintroduce a build-phase demo dependency ADR-0048 removed. `force-dynamic`
   keeps the throw at request time and bakes nothing.
