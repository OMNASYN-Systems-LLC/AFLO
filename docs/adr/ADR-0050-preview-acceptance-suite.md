# ADR-0050: Preview acceptance suite — the runnable gate in front of Neon main (Workstream B12)

## Status

**Accepted** — 2026-07-23 (founder CONTINUOUS EXECUTION AUTHORIZATION
2026-07-23, Workstream B12)

## Context

Every structural database invariant ΛFLO depends on — fail-closed RLS org
isolation (0003/0005/0006/0009), the two-role resolver privilege wall
(0007/0008), the founder's org-scoped open-review uniqueness tuple (0010),
playbook governance columns (0011), and the kernel-derived enum vocabularies —
is proven credential-free by per-area PGlite tests. But those proofs each
bootstrap their own throwaway database; none of them can be pointed at an
ARBITRARY target. The founder's precondition for ever touching Neon `main` is
stronger than "the tests pass": a FRESH database, migrated by the committed
migrations on the real branch, must be **provably exactly what the committed
migrations say it should be** — schema, RLS posture, roles, grants, function
ownership, constraints, and enums — with a runnable, aggregated verdict.

The cutover runbook (`docs/deployment/AUTH_CUTOVER_RUNBOOK.md`) already
prescribes role provisioning and per-branch migration order, and lists a
handful of manual post-apply verification queries. Manual queries do not scale
to the full invariant surface and cannot gate anything.

## Decision

### One runnable acceptance suite: `packages/database/src/acceptance/`

A suite of pure check functions, each taking a minimal `AcceptanceDb` handle
(structural — PGlite and node-postgres both satisfy it) and returning a
structured `{check, passed, detail}` result, aggregated by
`runAcceptance(db, opts): AcceptanceReport`. **It AGGREGATES the invariants
the per-area tests pin, against an arbitrary target — it does not replace
those tests.** The thirteen checks:

1. `migrations.journal_matches_directory` — drizzle journal entries are
   contiguous (`idx` 0..N, tag prefixes match), the `.sql` files on disk match
   the journal exactly (no extras, no gaps), and every entry has its
   `meta/NNNN_snapshot.json`.
2. `migrations.snapshot_chain_integrity` — the snapshot chain 0000→0011 holds
   **by value**: snapshot 0000's `prevId` is the zero uuid and every later
   snapshot's `prevId` === its predecessor's `id` (the PR #88 lesson, now a
   target-independent check).
3. `migrations.applied_in_journal_order` — the target's
   `drizzle.__drizzle_migrations` rows correspond 1:1, in order, with the
   journal: same count, `created_at` = journal `when`, and each `hash` =
   sha256 of the committed file (the exact drizzle migrator algorithm). A
   database produced by hand-authored DDL cannot pass.
4. `rls.tenant_tables_enforced` — for EVERY tenant table **derived
   programmatically from `schema.ts`** (every pgTable with a NOT NULL
   `organization_id` column — 35 today; the NOT NULL discriminator is what
   excludes `session_revocations`, whose org id is an optional scope on a
   resolver-path table): RLS ENABLED **and** FORCED, exactly one policy, named
   `org_isolation`, PERMISSIVE, FOR ALL, with USING and WITH CHECK both
   deparse-equal to the `nullif(current_setting('app.current_org_id', true),
   '')::uuid` fail-closed shape.
5. `roles.tenant_role_posture` — `aflo_app` exists, NOT superuser, NOT
   BYPASSRLS.
6. `roles.resolver_role_posture` — `aflo_auth_resolver` exists WITH BYPASSRLS,
   not superuser.
7. `grants.resolver_read_paths` — the resolver holds SELECT/INSERT/UPDATE/
   DELETE on the three un-scoped tables (`identity_provider_accounts`,
   `provider_webhook_events`, `session_revocations`; migration 0007), SELECT
   on `invitations` (0007), and SELECT on `users`/`organization_members`/
   `client_user_links` (0008).
8. `grants.tenant_role_walled_off` — `aflo_app` holds NO privilege on the
   three resolver-only tables and cannot EXECUTE
   `find_invitation_by_token` (the 0007 REVOKE wall is in effect).
9. `grants.tenant_audit_insert` — `aflo_app` holds INSERT on `audit_events`.
10. `function.find_invitation_by_token` — exists, SECURITY DEFINER, owned by
    `aflo_auth_resolver` (the BYPASSRLS ownership is what lifts RLS), empty
    pinned `search_path`, resolver-executable.
11. `constraints.key_indexes` — exact (normalized-deparse) definitions of
    `uq_review_items_open` on `(organization_id, artifact_type, artifact_id,
    artifact_version, workflow_type) WHERE state IN ('draft',
    'awaiting_review')` (the founder-decision 2026-07-23 #3 tuple, verbatim),
    `uq_playbook_versions_playbook_version`, `uq_playbooks_org_key`, and the
    `uq_invitations_pending_email` one-pending partial unique.
12. `enums.lockstep_with_schema` — every pgEnum declared in `enums.ts` exists
    in the target with EXACTLY the same labels in the same order (44 today).
    Because the kernel-owned enums are BUILT from the `@aflo/rules`/`@aflo/ai`/
    sibling-package constant arrays, this transitively locksteps the database
    against the kernel vocabularies.
13. `smoke.fail_closed_no_org_context` — runtime proof under the tenant role:
    with no org context (unset AND cleared-to-`''`), `SET ROLE aflo_app`
    sees ZERO rows on a tenant table — including a row seeded moments earlier
    in the SAME transaction, which is then ROLLBACKed (no trace left on a live
    target). Requires the acceptance connection to be able to
    `SET ROLE aflo_app` (grant membership: `GRANT aflo_app TO <acceptance
    role>`); anything else fails the check, closed.

A check that throws is converted into a failed result — the suite always
completes and always reports. The runner itself NEVER issues DDL.

### Two execution paths, one CLI: `pnpm --filter @aflo/database acceptance`

- **No env (CI, local):** bootstraps a FRESH PGlite provisioned exactly as
  runbook §2 prescribes for a Neon branch (roles + tenant DEFAULT PRIVILEGES
  BEFORE migrations, resolver starting with schema-usage only so migrations
  0007/0008 remain load-bearing), applies the committed migrations via the
  REAL drizzle migrator (so the bookkeeping check runs), executes all checks.
  The vitest wrapper `test/acceptance.test.ts` runs this same full path with
  the normal test suite — that is the CI wiring — plus drift-detection cases
  (a dropped policy and a BYPASSRLS'd tenant role each flip their check to
  failed).
- **`DATABASE_URL_ACCEPTANCE` set (operator, later):** the remote path,
  guarded as below. Validate-only by default.

### The remote hard guard (NON-NEGOTIABLE, `guard.ts`)

Before ANY check runs against a remote URL, the CLI refuses — exit 1, without
opening a connection — unless the target is AFFIRMATIVELY non-main:

1. URL must parse as `postgres://`/`postgresql://`.
2. **Main-like markers refuse outright:** host or database containing
   `main`, `prod`, `production`, `primary`, or `live` as a SUBSTRING is
   refused, even with a correct confirmation echo. Deliberately over-broad
   (e.g. "domain" refuses on "main") — over-refusal is safe, under-refusal is
   not.
3. **An affirmative discriminator is required:** the host or database must
   carry one of `preview`, `dev`, `development`, `staging`, `test`, `branch`,
   `acceptance`, `ephemeral`, `sandbox`, `localhost`, `127` as a clean TOKEN
   (split on `./-/_` — a letter run inside an unrelated word never counts).
   A URL with no verifiable discriminator is treated as potentially-main and
   refused: name the preview database/endpoint so the target is self-evidently
   not main.
4. **Second factor:** `ACCEPTANCE_CONFIRM_NON_MAIN` must exactly echo the
   URL's host. Missing or mismatched → refused.
5. **Remote DDL is opt-in:** migrations are applied to a remote target ONLY
   when `ACCEPTANCE_APPLY_MIGRATIONS=true` (exactly) is ALSO set; the default
   is validate-only. (The PGlite path always migrates — that is its purpose.)

The guard is a pure function with its own refusal-matrix tests
(`test/acceptance-guard.test.ts`); evaluating it never connects.

### The Neon-main precondition

**This suite passing against Neon PREVIEW — run by an operator with real
credentials via `DATABASE_URL_ACCEPTANCE`, after the runbook §2 provisioning
and §4 migration apply on that branch — is the founder-set precondition for
ever touching Neon `main`.** CI and agent sessions never hold a
`DATABASE_URL_ACCEPTANCE`; the remote path is exercised by a human operator
only. Applying anything to Neon `main` additionally keeps its existing
founder-sign-off requirement (runbook §4) — this suite gates, it does not
authorize.

## Consequences

- One command now answers "is this database exactly what the repo says it
  should be?" for any target, with a structured report — no more manual
  verification queries as the only cross-check.
- The tenant-table and enum sets are DERIVED from `schema.ts`, so future
  migrations are covered automatically; the vitest wrapper pins today's
  35-table set so additions remain conscious.
- The remote guard makes pointing the suite at production structurally hard:
  three independent refusal layers (marker, discriminator, echo) plus a
  DDL opt-in flag.
- The fail-closed smoke writes only inside a rolled-back transaction, so the
  suite is safe against a live preview branch carrying real synthetic data.
- Found and fixed en route: `test/migration.test.ts`'s enum-discovery helper
  matched nothing (drizzle pgEnums are callable, `typeof "function"`), making
  its CREATE TYPE check vacuous; the shared `declaredEnums()` iteration now
  handles callables and the test asserts non-vacuity (>30 enums).
- `tsx` joins `@aflo/database` devDependencies (already in the workspace via
  `apps/worker`) to run the CLI; the acceptance module is intentionally NOT
  exported from the package root index, keeping the dev-only PGlite driver out
  of the web app's import graph.
