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
- Only the three staff-side member roles are considered — filtered IN the
  SQL (`role IN (...)`) so a non-staff row never consumes a LIMIT slot.
  Exactly one ACTIVE membership resolves with status "active"; with none,
  the most recent INACTIVE staff membership resolves with status "revoked"
  (see Post-review hardening); 2+ active memberships are ambiguous → null.
- Only an ACTIVE client link resolves; 2+ active links are ambiguous →
  null. `assignedClientIds` is null (assignment scoping OFF — matrix §8
  default).

## Post-review hardening (adversarial review of PR #88)

The review returned DO NOT MERGE with two blockers (F1, F2); all findings
are remediated in this slice:

- **F1 — deterministic, fail-closed principal selection.** The staff-role
  narrowing moved INTO the SQL (`inArray(role, STAFF_MEMBER_ROLES)`), so
  `client`/`partner_viewer` rows can no longer consume the LIMIT and shadow
  a real staff membership. Selection policy is now explicit: 2+ ACTIVE
  staff memberships (multi-org staff) are AMBIGUOUS and resolve null —
  fail closed; multi-org membership needs an explicit org-selection
  mechanism in a later slice. Same for 2+ active client links. And the
  revoked-staff precedence is now REAL, not just documented: with no
  active staff membership, the most recent inactive staff membership
  resolves with status "revoked", so a deactivated staff member who is
  also an active client reaches `buildSessionContext` as REVOKED STAFF
  (the engine denies with `membership_revoked`) — never as a working
  client session.
- **F2 — snapshot chain restored.** `meta/0008_snapshot.json` now exists
  (chained `prevId` → 0007's id, `users.sessions_invalidated_before`
  added), so the drizzle-kit baseline chain matches the journal and future
  `generate` runs diff against reality.
- **F3 — least-privilege runbook provisioning.** The cutover runbook's
  resolver provisioning no longer grants `ON ALL TABLES`; the role gets
  schema USAGE only and its table privileges come from migrations 0007
  (identity/webhook/revocation tables + invitations SELECT) and 0008
  (principal tables SELECT) — the migrations are load-bearing. The
  sequence grant was dropped (every resolver-written table uses uuid
  `gen_random_uuid()` defaults; there are no sequences).
- **F4 — the identity cross-check is real.** The directory returns the
  STORED `identity_provider_accounts.provider_user_id` as
  `identity.clerkUserId` (never echoes the input), so the adapter's
  mismatch check in `provider-session.ts` compares the database's mapping
  to the session instead of the input to itself.
- (F6 — the 0008 migration comment now states correctly that `users` is a
  global NO-RLS table; `organization_members`/`client_user_links` are the
  RLS-forced ones.)

## Consequences

- **12 new tests → 198 database tests**, on PGlite UNDER
  `aflo_auth_resolver` with the deploy-ordered migrations (baseline → role
  → 0007 → 0008): staff, client-link, platform-admin, disabled, cutoff
  round-trip, stranger (incl. cascade-deleted user), revoked-link
  fail-closed, deactivated-membership → status "revoked", ambiguous
  multi-org staff and multi-org client bindings → null, SQL role filter
  ignoring a non-staff membership row, revoked-staff-plus-active-client
  precedence threaded through `buildSessionContext` (membershipStatus
  "revoked", role `staff_advisor` — not a client session), and an
  end-to-end staff/pre-cutoff thread-through.
- The credential-gated remainder of the session path is now ONLY composition:
  Clerk `auth()` closure → `ProviderSessionContextProvider` with this
  directory + the revocation gate over `DrizzleSessionRevocationRepository`.
- ⛔ Applying 0008 to Neon dev/preview stays credential-gated (pipeline
  `db:migrate`; never `main`). `disableAccount`/`revokeAllSessions` writes to
  the new column land with the account-lifecycle wiring slice.
