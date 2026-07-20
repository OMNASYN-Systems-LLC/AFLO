# ADR-0030: Auth-resolver privilege boundary (grant matrix + SECURITY DEFINER accept-by-token)

## Status

**Accepted** — 2026-07-20 (Production Cutover directive, PHASE 5 resolver half;
resolves the blocking prerequisite ADR-0026 raised)

## Context

ADR-0026 shipped three **un-scoped** auth tables — `identity_provider_accounts`,
`provider_webhook_events`, `session_revocations` — deliberately exempt from
org-RLS because the auth resolver reads them **before or across** an org context.
It flagged a MEDIUM: the compensating "privileged service path" was only
*asserted*. Under a single non-BYPASSRLS tenant role, that role could read these
tables table-wide with no RLS backstop. ADR-0026 set the bar: **before the
resolver is wired, the deployment MUST** either use a distinct least-privileged
resolver role with the tenant role `REVOKE`d off these tables, or commit an
explicit grant matrix — and `session_revocations` reads must be user-scoped.

Separately, the accept-by-token invitation lookup reads `invitations` (which is
FORCE-RLS) **before** an org context exists, so a plain read returns nothing — it
needs a privileged path too.

## Decision

Migration **0007** (a hand-written custom migration; no schema change) makes the
boundary real and testable, as committed DDL:

### 1. `find_invitation_by_token(varchar)` — SECURITY DEFINER

A `SECURITY DEFINER` SQL function returning the (0 or 1) invitation whose
globally-unique `token_digest` matches. Because it runs with its **owner's**
rights, and the owner is the BYPASSRLS resolver role, it reads `invitations`
across orgs without an org context — exactly what accept-by-token needs. `EXECUTE`
is revoked from `PUBLIC`, so only the resolver identity can call it. `SET
search_path = public` pins name resolution (a standard SECURITY DEFINER
hardening).

### 2. Grant matrix (the two-role model)

Roles are provisioned by the **deploy pipeline** (Neon), not created in the
migration:

- **`aflo_app`** — the tenant-request role (the ADR-0025 runtime role),
  **NON-BYPASSRLS**. Migration 0007 `REVOKE`s all privileges on the three
  un-scoped tables from it, so a tenant connection can never read them directly.
  It is also not granted `EXECUTE` on the resolver function, so it cannot resolve
  an invitation by token either.
- **`aflo_auth_resolver`** — the privileged resolver identity, **BYPASSRLS**. It
  owns the function (so the SECURITY DEFINER call bypasses RLS), and is the sole
  reader/writer of the three un-scoped tables plus `SELECT` on `invitations`.

The role-specific statements are wrapped in `IF EXISTS (SELECT 1 FROM pg_roles …)`
guards, so on a database where the roles are not yet provisioned (fresh / local /
the other PGlite test suites) the migration is a **safe no-op** for those
statements rather than an error — and `REVOKE … FROM PUBLIC` on the function and
the three tables applies unconditionally as a floor.

## Consequences

- **Proven credential-free on PGlite** (`resolver-grant-matrix.test.ts`, ordering
  mirrors deploy — tables + baseline grants, then 0007 tightens): `aflo_app`
  cannot `SELECT` any of the three un-scoped tables (permission denied), cannot
  `EXECUTE` the function, and cannot resolve the invitation via a direct pre-org
  read (RLS → zero rows); `aflo_auth_resolver` **can** read the three tables, and
  its function returns the invitation by token with **no org context** (and zero
  rows for an unknown token); a revocation is readable user-scoped. **139
  database tests total.** No schema change (`db:generate` reports no drift); no
  destructive statements.
- **The other test suites are unaffected** — they use `app_user`, so 0007's
  role-guarded grants are inert there.
- **Deployment requirements (documented, credential-gated).** The deploy pipeline
  must provision `aflo_app` (non-BYPASSRLS) and `aflo_auth_resolver` (BYPASSRLS),
  and the migration-runner role must be a member of `aflo_auth_resolver` to
  reassign the function's owner. The application then opens the tenant path under
  `aflo_app` (via `withOrgContext`) and the resolver path under
  `aflo_auth_resolver`.
- **Next (immediate) slice:** the resolver-path repositories over the three
  un-scoped tables (`IdentityAccountRepository`, `WebhookEventRepository`,
  `SessionRevocationRepository`) running on the resolver connection (no
  `withOrgContext`), with `session_revocations` reads **user-scoped** (`WHERE
  user_id = <resolved user>`), plus the accept-by-token orchestration that calls
  `find_invitation_by_token` and applies the binding. This migration is their
  prerequisite.
