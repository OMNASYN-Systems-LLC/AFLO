# ADR-0041: Review Center / Playbook / Discovery persistence (migration 0009)

## Status

**Accepted** — 2026-07-23 (founder directive 2026-07-20 + continuation
2026-07-22, Workstream A PR-4 — design brief §4)

## Context

The Review Center kernel (ADR-0034), the Playbook kernel + Golden Key drafts
(ADR-0038), and the analytics derivations (ADR-0040) are pure functions over
plain records. This slice gives those records durable, tenant-isolated
PostgreSQL homes — WITHOUT touching any existing table, enum, or kernel: the
design brief's standing constraint is that domain kernels (roadmap.v1,
report.v1, document.v1, `ai_review_status`, …) keep their vocabularies and
stay authoritative for their tables. Migration 0009 is therefore additive
only, and the PR #88 lesson applies: the drizzle snapshot chain
(`meta/*_snapshot.json` + `_journal.json`) is part of the deliverable — a
broken `prevId` chain silently corrupts every future `drizzle-kit generate`.

## Decision

**Schema (`enums.ts` + `schema.ts`).** Six pgEnums built FROM the kernel
constant arrays via the existing `tuple()` idiom — `review_item_state`,
`review_artifact_type`, `review_risk_class`, `reviewer_role`,
`review_decision`, `workflow_discovery_status` — so the DB and the kernels
can never disagree (lockstep-tested). There is deliberately NO
`playbook_version_status` enum: `PLAYBOOK_VERSION_STATUSES` IS
`REVIEW_ITEM_STATES` (one review vocabulary, ADR-0038), so
`playbook_versions.status` reuses `review_item_state`. Five tables, exactly
per design brief §4:

- **`review_items` — a coordination layer, not a second system of record.**
  A row REFERENCES its artifact (`artifact_type` + text `artifact_id`, the
  audit-events convention) and carries integrity/provenance metadata ONLY:
  fact identifiers + freshness timestamps (never values), rule versions,
  model/prompt labels copied once from the immutable `ai_runs` row,
  confidence (null = deterministic/manual), risk class, required reviewer
  role, reviewer/publish stamps, sha256 modification digests (never edited
  content), playbook provenance, outcome fields, and self-FKs
  (`previous_review_item_id` / `superseded_by_review_item_id`, SET NULL).
  Org/client FKs are **RESTRICT** (compliance-sensitive class — review
  history must outlive convenience deletes). Partial unique
  `uq_review_items_open (artifact_type, artifact_id) WHERE state IN
  ('draft','awaiting_review')`: at most one OPEN review per artifact —
  replacements supersede, they never coexist. Queue index
  `(organization_id, artifact_type, state)` + `(organization_id, client_id)`.
- **`review_decisions` — append-only** (`decided_at` only, no `updated_at`;
  the audit_events/notes pattern). Decision + structured `RVD_*` reason code
  + rule version + decider + stage/workflow/agent echoes for analytics +
  edited-field NAMES + final-output sha256 digest. **Data governance,
  recorded on the table itself:** review feedback is used ONLY for
  analytics, rule improvement, prompt improvement, workflow improvement, and
  QA — NEVER for uncontrolled model training (directive 2026-07-20).
- **`playbooks` (identity) + `playbook_versions` (append-only content)** —
  the `rule_versions (rule_id, version)` pattern, but org-scoped + RLS
  because playbook content is tenant IP (the global non-RLS `rule_versions`
  table would leak it). Unique `(organization_id, playbook_key)` and
  `(playbook_id, version)`. `playbooks.current_version_id` is a REAL
  circular FK (SET NULL) — declared with drizzle's `AnyPgColumn` callback,
  constraint added after both tables exist in the generated migration.
- **`workflow_discovery_items`** — the anti-invention question queue
  (`open → answered → converted`; dismissed/reopen), with
  answer/answered-by/`converted_playbook_version_id` bookkeeping and the
  `(organization_id, status)` index.

**Migration `0009_review_center_persistence.sql`** — drizzle-kit-generated
(6 CREATE TYPE, 5 CREATE TABLE, FKs, indexes) + the 0003-shape RLS block for
ALL FIVE tables: `ENABLE` + `FORCE ROW LEVEL SECURITY` and the fail-closed
`org_isolation` policy on
`nullif(current_setting('app.current_org_id', true), '')::uuid`. Zero ALTER
on existing objects; zero destructive statements. **Snapshot chain intact:**
`meta/0009_snapshot.json` carries a fresh id with `prevId` = the 0008 id, and
the journal entry follows the established `when` spacing.

**Repositories (`repositories/review-center.ts`, wired into
`createRepositories` on the TENANT handle).** Every operation runs inside
`withOrgContext` (ADR-0025); `organizationId` is always a method parameter,
never read from a domain object; typed not-found/conflict errors;
unique-violation detection via `.cause` inspection (the invitation idiom).
**Cross-org reference guard (adversarial-review F1): FK validation bypasses
RLS, so EVERY caller-supplied cross-table reference — client, playbook,
playbook version, review item (previous/superseded-by), organization member
(creator/reviewer/decider/author/approver/raiser/answerer), ai_run — is
verified visible via a one-row SELECT inside the SAME `withOrgContext`
transaction before it is written; a foreign org's id fails with a typed
not-visible error (never echoing foreign data) and no row is written
(PoC-mirroring tests).**

- `DrizzleReviewItemRepository` — `create` (draft, or directly
  `awaiting_review` for gated AI output — the two birth states are ALSO
  enforced at runtime, so a cast can never mint a later state (F4);
  open-slot conflict → `OpenReviewItemExistsError`), `getById`,
  `listByOrg(state?/type?)`,
  `saveTransition(orgId, itemId, toState, now, patch?)`: the caller supplies
  a KERNEL-APPROVED transition and this method persists it plus bookkeeping
  (`submitted_at` on FIRST entry into awaiting_review, reviewer stamps,
  `published_at`, superseded-by link, escalated reviewer floor) — **it never
  re-decides legality** (that is the store's job, PR-5, exactly like every
  existing kernel-backed repo) — and
  `recordDecisionAndTransition(orgId, {decision fields, toState, headPatch})`,
  **THE store entry point for review decisions (PR-5 must use it)**: appends
  the `review_decisions` row AND moves the `review_items` head columns in ONE
  transaction (rollback-proven), with `latest_decision`/
  `latest_decision_reason_code`/`reviewed_by` taken FROM the decision record
  (typed out of the patch) so the denormalized head can never drift from the
  append-only log (F3). `append`/`saveTransition` remain for the non-decision
  paths.
- `DrizzleReviewDecisionRepository` — `append` + `listByItem` and NOTHING
  else. No update or delete exists on the class, structurally
  (test-asserted): the feedback log cannot be rewritten.
- `DrizzlePlaybookRepository` — `createPlaybook`, `getByKey`,
  `saveDraftVersion` (rejects `validatePlaybookContent` errors at the door),
  and `transitionVersion`, **the ADR-0038 enforcement boundary made real**:
  (a) legality from `playbookVersionTransition`, denied with the kernel
  reason code; (b) `approved`/`published` DENIED with
  `PlaybookApprovalBlockedError` while `contentBlocksApproval` is non-empty
  — a version carrying any `discovery_required` field (every Golden Key
  seed) can never present an unresolved question as settled process; (c) on
  publish, superseding the current published version, stamping the effective
  date, and moving `current_version_id` happen in ONE `withOrgContext`
  transaction — a failure anywhere rolls back everything.
- `DrizzleWorkflowDiscoveryRepository` — `raise`, `listByOrg(status?)`,
  `transition` via `workflowDiscoveryTransition` with required bookkeeping
  (`answered` needs an answer; `converted` needs the org-visible playbook
  version that absorbed it).

## Consequences

- **47 new tests → 255 database tests** (PGlite, non-superuser role,
  migrations applied in order; the delta counts every test added on this
  branch vs `main`, including the parametrized enum-lockstep cases the new
  enums generate): per-table RLS isolation for all five tables
  (repository-level cross-org invisibility, raw per-table counts, fail-closed
  unset/empty context, cross-org write rejection — plus the auto-derived
  `rls.test.ts` coverage, which picks the new tables up from the schema);
  open-review partial unique (second open item rejected in both open states;
  a closed item frees the slot for a linked successor); append-only decision
  surface; **cross-org FK-write guards PoC'd for playbook / previous +
  superseded review item / member / ai_run references (typed error, no row
  written)**; escalation preserving `submitted_at`; atomic
  decide-and-transition (success writes both, forced mid-op failure rolls
  back both); runtime birth-state assert; seed-draft approval BLOCKED; full
  publish chain; v2 publish supersedes v1 + moves the head atomically; denied
  publish changes nothing; discovery lifecycle incl. illegal transitions and
  missing-bookkeeping denials. Enum lockstep extended to the six new enums
  (incl. `review_item_state == PLAYBOOK_VERSION_STATUSES`).
- The store wiring (PR-5) gains real persistence targets; the mock-backed
  store keeps working untouched — no second active architecture, since the
  ReviewItem tables are a coordination layer and bridged domain tables remain
  authoritative for their own statuses.
- Live Neon apply stays credential-gated on `DATABASE_URL` (unchanged
  BUILD_STATUS conversion order); everything here is proven credential-free
  on PGlite, which is the same SQL the production migration runs.
- Escalation persistence rides on the decision path
  (`recordDecisionAndTransition` with `toState: awaiting_review` and a
  `requiredReviewerRole` raise in the head patch; `saveTransition` supports
  the same same-state persist) — no separate write path to drift. In both
  paths `submitted_at` stamps ONLY on the FIRST entry into
  `awaiting_review`, so an escalation never moves the review-time metric
  anchor (adversarial-review F2, test-proven).

## Known accepted gaps (founder-flagged)

Raised in the adversarial review of PR #92 and ACCEPTED as-is for this slice;
none require touching migration 0009 (all later fixes are additive):

- **`uq_review_items_open` is global, not org-scoped** — exactly per the
  design brief's index shape. A tenant could in principle "squat" an open
  review slot for another tenant's artifact id, or use the conflict as an
  existence oracle; both are bounded by UUID unguessability of foreign
  artifact ids. Org-scoping the index (`organization_id, artifact_type,
  artifact_id`) is a later ADDITIVE migration — flagged for founder review /
  PR-5.
- **One-published-version-per-playbook is flow-enforced only** — the
  publish→supersede→head-move transaction is the single write path, but there
  is no partial unique index or `FOR UPDATE` lock backing it at the DB level.
  A backing additive index (`playbook_id WHERE status = 'published'`) can
  land later without data change.
- **No DB-level REVOKE backstop for append-only `review_decisions`** — the
  append-only property is structural in the repository surface
  (test-asserted), matching the `audit_events` precedent; the `aflo_app` role
  can still technically UPDATE/DELETE. Adopt a grant-matrix migration
  (REVOKE UPDATE/DELETE) in a later slice, alongside the same hardening for
  the other append-only tables.
