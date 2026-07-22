# ADR-0035: Provider-backed session-context adapter (Workstream B3)

## Status

**Accepted** — 2026-07-22 (founder continuation directive 2026-07-22,
Workstream B item 3)

## Context

The credential-free data layer is complete (ADR-0026–0033): identity tables,
repositories, accept-by-token orchestration, and the two role-scoped connection
factories. What turns a REAL Clerk session into an authorized request is the
bridge session → `SessionContext` → `Principal` → `authorize()` →
`withOrgContext`. The founder's directive is explicit: **do not stop Workstream
B because hosted credentials are unavailable** — build the adapter, DI, and
tests credential-free, so activation is composition, not new logic.

Two facts shape the design:

1. Principal resolution happens **BEFORE any org context exists** — the org is
   discovered FROM the membership/client link, exactly like accept-by-token
   (ADR-0032). So the ΛFLO-side reads belong on the RESOLVER path, not under
   `withOrgContext`.
2. The deterministic derivation (disabled-account gate, revoke-all cutoff, role
   precedence platform-flag → membership → client-link) ALREADY exists in
   `buildSessionContext` (ADR-0019/0024) and is fully tested. The adapter must
   add composition only — no second authority.

## Decision

`packages/auth/src/provider-session.ts` — pure, credential-free, in the barrel
(no node:crypto, client-bundle-safe):

- **`VerifiedProviderSession`** — the verified facts of the current provider
  session (`provider`, `providerUserId`, `providerSessionId`, `issuedAtIso`).
  Produced ONLY by server-side provider verification; the browser never
  supplies any of it. The raw session id is carried in memory for the
  revocation gate but never persisted (digests only, ADR-0026).
- **`ProviderSessionSource`** (port) — yields the current request's verified
  session or null. Production = a thin closure over Clerk's `auth()` in the
  composition root (documented in the module header); tests = stubs. The
  adapter never verifies tokens and never reads env.
- **`PrincipalDirectory`** (port) — loads `PrincipalRecords` (identity row,
  active staff membership, active client link, assignment scoping) for a
  provider identity. Null for an unmapped identity: **authentication alone
  grants nothing** until an invitation binds the identity (the
  identity-claiming invariant, ADR-0022). The Drizzle implementation (next
  slice, B5) runs on the resolver connection.
- **`SessionRevocationGate`** (optional port) — digest-specific ("sign out
  this device") revocation over `session_revocations` (ADR-0030).
  `buildSessionContext` already enforces the users-row cutoff (revoke-all /
  disable); the gate adds the per-session check. Implementations digest the
  raw session id server-side. **A failing revocation store fails CLOSED** —
  the error propagates; the adapter never mints a session past a gate it
  could not evaluate.
- **`ProviderSessionContextProvider`** (implements `SessionContextProvider`)
  — fail-closed pipeline: verified session → malformed-fact rejection (empty
  ids / unparsable issued-at never reach the directory) → principal load →
  **identity cross-check** (the directory's row must be the mapping for THIS
  provider user — a mismatch resolves as unauthenticated, never as someone
  else) → revocation gate → `buildSessionContext` with `issuedAtIso` threaded
  into the cutoff check.

## Consequences

- **12 new tests → 109 auth tests**: null-session and malformed-fact rejection
  (directory provably never consulted), unmapped identity, identity mismatch,
  staff/client/platform-admin resolution, disabled account, cutoff
  before/after via the threaded issued-at, gate revoked/live/error
  (fail-closed propagation), and gate argument fidelity (aflo user + RAW
  session id + issued-at).
- **Activation is composition**: the credential-gated remainder for this seam
  is (a) the Clerk `auth()` closure in `apps/web`, (b) the Drizzle
  `PrincipalDirectory` on the resolver connection + the resolver-role SELECT
  grants it needs (next slice), and (c) the `SessionRevocationGate` bound to
  `DrizzleSessionRevocationRepository` + a session-id digest helper.
- The legacy `AuthProvider`/`DemoAuthProvider` surface (session.ts/demo.ts)
  remains the demo runtime's seam and is unchanged; it is removed in
  Workstream B10 (demo-runtime removal), not here.
