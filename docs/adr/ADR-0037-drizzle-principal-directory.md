# ADR-0037: Drizzle PrincipalDirectory + principal-resolution grants (Workstream B5)

## Status

**Accepted** — 2026-07-22 (founder continuation directive 2026-07-22,
Workstream B item 5: principal resolution)

## Context

ADR-0035's provider-backed session adapter left one port unimplemented: the
`PrincipalDirectory` that loads the ΛFLO-side records (identity, membership,
client link) for a verified provider identity. Principal resolution happens
BEFORE any org context exists — the org is discovered FROM the membership or
link — so, like accept-by-token (ADR-0032), it belongs on the RESOLVER
connection, not under `withOrgContext`. Two schema gaps blocked it: `users`
had no revocation-cutoff column, and the resolver role had no read access to
the three principal tables.

## Decision

**Migration 0008** (forward-only, additive, role-guarded per the 0007
discipline):

1. `users.sessions_invalidated_before timestamptz NULL` — the ADR-0024
   revocation cutoff, now persistable. NULL = nothing revoked; no backfill.
2. `GRANT SELECT ON users, organization_members, client_user_links TO
   aflo_auth_resolver` — READ-ONLY (the directory never writes); the resolver
   is BYPASSRLS so SELECT suffices for the cross-org pre-context reads. The
   tenant role's access is unchanged.

**`DrizzlePrincipalDirectory`** (`repositories/principal-directory.ts`, on
`ResolverDb`, wired into `createRepositories` as `principalDirectory`):
mapping → users row → active membership → active client link, with
fail-closed mappings everywhere:

- No mapping / missing users row → null (an authenticated stranger stays
  unauthenticated until an invitation binds them, ADR-0022; the FK cascade
  makes a truly dangling mapping unrepresentable — the in-code guard is
  defense in depth).
- `is_active = false` → `accountStatus: "disabled"` (the adapter then
  resolves NO session).
- `sessions_invalidated_before` maps to the REQUIRED
  `sessionsInvalidatedBeforeIso` — ADR-0035 made the field non-optional
  precisely so this mapping cannot be silently forgotten.
- Only an ACTIVE membership resolves, and only the three staff-side member
  roles (the DB enum is wider); anything else falls through to the client
  link or null — an accepted fail-closed under-grant until the
  membership-lifecycle slice persists pending/revoked statuses.
- Only an ACTIVE client link resolves. `assignedClientIds` is null
  (assignment scoping OFF — matrix §8 default).

## Consequences

- **8 new tests → 194 database tests**, on PGlite UNDER `aflo_auth_resolver`
  with the deploy-ordered migrations (baseline → role → 0007 → 0008): staff,
  client-link, platform-admin, disabled, cutoff round-trip, stranger (incl.
  cascade-deleted user), revoked-link and deactivated-membership fail-closed,
  and an end-to-end `buildSessionContext` thread-through (staff resolves; a
  pre-cutoff session does not).
- The credential-gated remainder of the session path is now ONLY composition:
  Clerk `auth()` closure → `ProviderSessionContextProvider` with this
  directory + the revocation gate over `DrizzleSessionRevocationRepository`.
- ⛔ Applying 0008 to Neon dev/preview stays credential-gated (pipeline
  `db:migrate`; never `main`). `disableAccount`/`revokeAllSessions` writes to
  the new column land with the account-lifecycle wiring slice.
