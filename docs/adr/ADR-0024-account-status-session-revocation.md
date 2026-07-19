# ADR-0024: Account status + session revocation

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive —
disabled-account handling + session revocation)

## Context

The directive's production-readiness gates include "disabled users cannot sign
in" and "session expiry / revocation works." The authorization engine already
denies a `disabled` principal (`account_disabled`), but that is the LAST line of
defense — a disabled user should not get a resolved session at all, and
disabling an account (or a "sign out everywhere") must invalidate sessions that
were issued before the action, immediately. This is ΛFLO-owned account state,
independent of role/membership, so it is pure and testable now.

## Decision

Add `account.ts` to `@aflo/auth` (pure, in the barrel) and wire two fail-closed
checks into the session resolver:

- **`AccountState`** — `{ afloUserId, status (active|disabled),
  sessionsInvalidatedBeforeIso, updatedAtIso }`. The cutoff is the revocation
  instant: any session issued strictly before it is dead.
- **`disableAccount`** — active → disabled AND sets the cutoff to `nowIso`
  (disable revokes all live sessions at once). **`reactivateAccount`** — disabled
  → active but LEAVES the cutoff (reactivation lets the user sign in again with
  new sessions; it does not resurrect pre-disable sessions). **`revokeAllSessions`**
  — set the cutoff without changing status ("sign out everywhere"). Deny-by-default
  (`already_active`/`already_disabled`); input never mutated.
- **`isSessionRevoked(issuedAtIso, cutoffIso)`** — pure check, fails closed on an
  unparseable timestamp; `null` cutoff ⇒ never revoked; equal instant is still
  valid.
- **`buildSessionContext` now fails closed** (session-context.ts): a `disabled`
  `accountStatus` resolves to **null** (no session), and a session whose
  `sessionIssuedAtIso` precedes `identity.sessionsInvalidatedBeforeIso` resolves
  to **null**. `AfloIdentity` gains the optional cutoff; `SessionContextInput`
  gains the optional `sessionIssuedAtIso`.

## Consequences

- **Defense in depth.** A disabled/revoked user is rejected at the session layer
  (no context) AND at the engine (`account_disabled`) — the session-context tests
  now assert both, and the engine test constructs its disabled principal directly
  so both layers stay independently covered. 11 new tests → 97 auth tests.
- **Backward compatible.** The new identity/​input fields are optional; existing
  callers that omit `sessionIssuedAtIso` simply skip the revocation check (a
  disabled account is still rejected).
- **Not yet wired.** Persisting `AccountState` (Drizzle), and the session
  resolver actually passing the current session's issued-at + the account's
  cutoff, are credential-gated (Clerk session + Neon). The Clerk-backed provider
  must populate `sessionIssuedAtIso` from the verified session and
  `sessionsInvalidatedBeforeIso` from the stored account — documented for that
  slice.
