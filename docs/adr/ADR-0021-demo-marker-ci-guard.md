# ADR-0021: Demo-identity marker CI guard

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive,
PHASE 6 — "Remove demo auth")

## Context

The founder's non-negotiable: outside automated tests, ΛFLO must never use
demo/mock/synthetic **identity**. The runtime contract (ADR-0017) already fails
closed at BOOT in production. But between now and the Clerk swap the app still
runs on the demo `AuthProvider`, and nothing stops a new slice from quietly
introducing another demo identity into runtime code that would only surface as a
production boot failure much later. The directive explicitly asked for "a CI test
that fails when production bundles contain known demo identity markers."

## Decision

Add `scripts/check-demo-markers.mjs`, run in CI (the `verify` job, after lint) via
`pnpm check:demo-markers`:

- Scans `apps/*/src` and `packages/*/src` for precise demo-identity/session
  markers — `DemoAuthProvider` and the string literals `demo-user`,
  `demo-client`, `portal-demo-client`, `mock-session`, `synthetic-session`,
  `demo-staff`, `demo-org`. (Deliberately NOT generic words like "hardcoded",
  which match unrelated comments.)
- **Test files are exempt** (demo identities are allowed in tests).
- An explicit **ALLOWLIST** names the one demo runtime path that exists today:
  `packages/auth/src/demo.ts` (the `DemoAuthProvider` class) and
  `apps/web/src/lib/data.ts` (the composition root that instantiates it). A demo
  marker anywhere else fails the build (exit 1) with file:line + the marker.
- The script prints what it scanned and every allowlisted path (no silent skips).

## Consequences

- **New** runtime demo identity fails CI; the **known** prototype path is tracked,
  not hidden. The allowlist is the burn-down list: it **must reach zero when the
  Clerk-backed provider replaces the demo one**, at which point the guard forbids
  demo identity in all runtime code.
- This is a static complement to ADR-0017's boot-time enforcement — belt (CI)
  and suspenders (runtime), per the matrix's defense-in-depth stance.
- Verified both directions: passes today (only the two allowlisted files carry
  markers); fails on an injected marker in any other `src` file.
- It matches on source text, not built bundles — simpler and catches the marker
  at authoring time; the runtime contract remains the bundle/boot-level backstop.
