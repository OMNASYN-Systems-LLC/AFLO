# ADR-0029: Org-scoped identity repositories (invitations + client-user links)

## Status

**Accepted** — 2026-07-20 (Production Cutover directive, PHASE 5 — repositories
over the persisted auth tables; the org-scoped half)

## Context

Migration 0005 (ADR-0026) added the five auth-persistence tables but nothing
read or wrote them. Two of those tables — `invitations` and `client_user_links`
— are **org-scoped** (carry `organization_id`, FORCE RLS), so their repositories
are the direct analog of the messaging repository (ADR-0028): `withOrgContext`
+ RLS. The other three (`identity_provider_accounts`, `provider_webhook_events`,
`session_revocations`) are the un-scoped **resolver** tables and need the
privileged resolver path (least-privileged role / grant matrix, `SECURITY
DEFINER` accept-by-token) that ADR-0026 flagged as a blocking prerequisite —
kept as a **separate** slice for focused review.

## Decision

Add to `@aflo/auth` the `InvitationRepository` and `ClientUserLinkRepository`
contracts (co-located with the invitation/membership domain), and implement them
in `@aflo/database` as `DrizzleInvitationRepository` /
`DrizzleClientUserLinkRepository`. `@aflo/auth` is a leaf (no workspace deps), so
the new `database → auth` edge is cycle-free.

- **Every op runs inside `withOrgContext`** (ADR-0025) → RLS (migration 0005)
  scopes it to one org on a transaction-local GUC.
- **Tokens are digest-only.** `issue` writes `invitations.token_digest =
  Invitation.tokenHash` (sha256 hex). The raw token is never passed to the
  repository and is not representable in the `Invitation` domain type — it lives
  only in the emailed link. A test dumps the persisted row and asserts the raw
  token appears nowhere.
- **Deterministic transitions persisted, not re-decided.** `save` writes the
  result of the pure invitation kernel (`acceptInvitation` / `revokeInvitation` /
  `expireInvitation`) — status, accepted-by/at, and a repository-stamped
  `revoked_at` (the domain has no revoked-at field). The repository never invents
  a transition.
- **One active link each way is DB-enforced.** `link` relies on the two
  partial-unique-on-`active` indexes (`(org, client) WHERE active`, `(org, user)
  WHERE active`); a second active link for either side raises `23505`, surfaced
  as `ClientAlreadyLinkedError`. Revoking frees both sides so a fresh link can be
  created (proven by revoke-then-relink).

### `organization_id` is never caller-influenced

Both repositories take `organizationId` as the first argument and use it both for
the `withOrgContext` GUC and as the inserted `organization_id` — a row can only
be written into the current org, and RLS `WITH CHECK` is the backstop. The
`Invitation.organizationId` field carried in the domain object is not trusted for
the write (the parameter wins), so a mismatched domain object can't cross tenants.

### Referenced clients are verified in-org (FK bypasses RLS)

FK validation bypasses RLS, so a client invitation's `intended_client_id` or a
link's `clientId` could otherwise dangle-reference a client in another org. Both
`issue` (for a client invitation) and `link` therefore run the messaging
repository's `createThread`-style guard — a `withOrgContext`-scoped `SELECT` on
`clients` that is RLS-invisible for a foreign client — and reject with
`ClientNotInOrganizationError`. (The `client_user_links.userId` references the
global, non-org-scoped `users` table, so it is not org-checked here.) This
adopts the ADR-0028 precedent uniformly rather than deferring it.

### Authorization boundary

Same separation as the rest of the system: these repositories enforce **org
isolation** (RLS) and the DB uniqueness invariants. WHO may issue/revoke an
invitation or manage a link (owner/admin-reserved) is the authorization engine's
job (ADR-0018 `organization.manage_members`) at the calling route — not the
repository's.

## Consequences

- **Proven credential-free on PGlite** (`invitation-repository.test.ts`,
  non-superuser role): issue + read-back (staff + client-reservation), digest-only
  storage (raw token absent from the row), org isolation, status-filtered listing,
  accept + revoke transitions (with `revoked_at` stamped), the one-active-link
  invariant in both directions, revoke-then-relink, and not-found errors.
  **131 database + 97 auth tests**; workspace typecheck/lint + web build +
  demo-marker guard green.
- **`@aflo/database` now depends on `@aflo/auth`** (leaf, cycle-free), joining
  `@aflo/security` from ADR-0028.
- **Not yet wired.** Routing handlers through these repositories on a live Neon
  connection is credential-gated (`DATABASE_URL` + the interactive-tx driver).
- **Deferred to the resolver slice (next):** the un-scoped resolver-table
  repositories (`identity_provider_accounts`, `provider_webhook_events`,
  `session_revocations`), the `SECURITY DEFINER` accept-by-token invitation
  lookup (the accept read precedes org context), and the ADR-0026
  least-privileged-resolver-role / grant-matrix invariant + user-scoped
  `session_revocations` reads. Those share the privileged-path infrastructure and
  warrant their own review.
