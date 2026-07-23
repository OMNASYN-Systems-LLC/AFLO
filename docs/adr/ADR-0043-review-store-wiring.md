# ADR-0043: Review Center store wiring + org-scoped open-review uniqueness (migration 0010)

## Status

**Accepted** — 2026-07-23 (founder CONTINUOUS EXECUTION AUTHORIZATION
2026-07-23, Workstream A PR-5 — implements the four founder decisions as
resolved defaults, verbatim below)

## Context

The Review Center kernel (ADR-0034), the Playbook kernel + Golden Key drafts
(ADR-0038), the analytics derivations (ADR-0040), and the persistence layer
(ADR-0041) existed unwired: no store surface created, decided, published, or
superseded a ReviewItem; no actor policy governed who may author, approve, or
publish a playbook version; and the open-review unique index was global, not
org-scoped (an ADR-0041 known accepted gap flagged for this slice). The
founder's continuous execution authorization resolved the four open decisions
this slice depends on. This PR implements them EXACTLY and wires the shared
store (the prototype's Neon-shaped mutation layer) to the kernels, mirroring
the Drizzle repository semantics.

## Founder decisions (verbatim, now resolved defaults)

1. **Concierge recommendation risk.** "`concierge_recommendation` defaults to
   HIGH risk when it contains: credit-related guidance; debt prioritization;
   readiness-stage implications; partner or product routing; financial action
   recommendations; housing or funding readiness implications; any materially
   consequential recommendation. It requires explicit authorized human
   approval before publication. Purely informational education, navigation,
   or administrative support may be classified LOW or MEDIUM by deterministic
   policy."
2. **Playbook author/approver separation.** "Staff Advisor may draft and
   revise. Organization Admin may review and approve. Organization Owner may
   publish organization-wide playbooks. The same person may not both author
   and publish a playbook version. High-impact playbooks require separate
   author and approver identities. Platform Admin may not approve or publish
   tenant content. Clients have no access to drafts or internal review state.
   Where a tenant has only one authorized operator, the system may allow a
   documented owner override only if: an explicit reason is recorded; the
   override is audited; the content is not regulated professional advice; the
   override is visible in review history; the organization policy permits it."
3. **Open-review uniqueness.** "Open-review uniqueness must be
   organization-scoped. There may be only one active open review for:
   organization_id, artifact_type, artifact_id, artifact_version,
   workflow_type. Terminal reviews do not prevent a new review. A new
   artifact version requires a new review."
4. **Stale-artifact invalidation.** "review references artifact version and
   digest → artifact changes → review becomes stale → prior approval cannot
   publish changed content → new review required."

## Decision

### Kernels (`@aflo/rules`)

- **`conciergeRiskFor(flags, informationalClass)`** + `ConciergeContentFlags`
  (seven booleans mirroring decision 1's criteria exactly): ANY flag true →
  `"high"`; all false → the caller-chosen `"low" | "medium"`. Pure and
  deterministic. `DEFAULT_REVIEW_POLICIES` keeps `concierge_recommendation`
  at **HIGH as the fail-safe when flags are unknown** — the table VALUES are
  unchanged from PR #85, but the classification is no longer provisional:
  the "flagged for explicit founder confirmation" annotation is replaced by
  the founder-resolved statement in BOTH the kernel doc comment AND the
  exact-table test (the two were changed together, as this ADR records —
  the test still asserts the FULL table verbatim).
- **`canPublishReviewItem({actorRole, risk, requiredRole})`** — the founder
  matrix publication floor: a `high`-risk item requires `organization_admin`+
  REGARDLESS of `requiredReviewerRole` (Staff Advisor can never publish
  high-risk artifacts); medium/low require rank ≥ the item's required
  reviewer role; null/non-reviewer roles always denied.
- **`canActOnPlaybookVersion(input)`** (decision 2 made deterministic):
  role floors draft/revise/submit = staff+, approve = `organization_admin`+,
  publish = `organization_owner` ONLY; the author may never publish their own
  version (`PB_AUTHOR_PUBLISHER_SEPARATION`); a HIGH-IMPACT version requires
  approver ≠ author (`PB_AUTHOR_APPROVER_SEPARATION`); `actorRole: null`
  (Worker, Platform Admin, client — no qualifying membership) is always
  denied (`PB_NO_MEMBERSHIP`). The owner override relaxes ONLY the separation
  rules, ONLY for an owner, ONLY when `orgPolicyPermitsOverride` AND the
  override carries a non-empty reason AND `attestsNotRegulatedAdvice ===
  true` (the type requires the literal `true`); an override-allowed result is
  `PB_OWNER_OVERRIDE` with `usedOwnerOverride: true`, which obligates the
  store to record + audit it. **High-impact definition (resolved default,
  deterministic): a playbook version is high-impact iff its
  `PlaybookContent.humanReviewCheckpoints` contains any checkpoint with
  `riskClassification: "high"`** (`isHighImpactPlaybookContent`).
- Reason-code catalog additions: `RVC_BLOCKED_ENVELOPE` (an envelope with
  non-empty `prohibited_actions_detected` can never become a ReviewItem) and
  `RVC_STALE_ARTIFACT` (decision 4's denial), plus the new `PB_*` actor-policy
  codes. Registry entries: `review_center.publication_policy`,
  `review_center.concierge_risk`, `playbook.actor_policy`.

### Migration 0010 (`@aflo/database`) — decision 3 verbatim

`0010_review_scoping.sql`, forward-only and non-destructive: three ADDITIVE
`review_items` columns — `artifact_version` (text NOT NULL), `artifact_digest`
(varchar(64) NOT NULL), `workflow_type` (`review_artifact_type` NOT NULL) —
and the `uq_review_items_open` partial unique index REPLACED with the
founder's tuple verbatim: `(organization_id, artifact_type, artifact_id,
artifact_version, workflow_type) WHERE state IN ('draft','awaiting_review')`.
The temporary column DEFAULTs exist only so the DDL is valid on a non-empty
table and are dropped immediately; the tables were born in migration 0009 and
no write path existed before this PR, so `review_items` is empty in every
environment — no data is touched, no data is dropped. **Snapshot chain intact
(the PR #88 lesson): `meta/0010_snapshot.json` carries a fresh id with
`prevId` = the 0009 snapshot's id, plus the `_journal.json` entry —
test-guarded.** `schema.ts` mirrors all three columns + the new index.

`DrizzleReviewItemRepository.create` now REQUIRES `artifactVersion`
(non-empty trimmed) and `artifactDigest` (64-char lowercase sha256 hex,
validated) and takes `workflowType` defaulting to `artifactType` at the
call-site type level only — never silently in SQL. Publication (decision 4):
`saveTransition` to `published` REQUIRES the caller-supplied
`currentArtifactVersion` + `currentArtifactDigest` in the patch and compares
BOTH against the stored values — mismatch OR omission throws
`StaleReviewItemError` and nothing is written; the correct path is
supersession + a fresh ReviewItem for the new version. Never artifact bodies:
version string + sha256 digest only.

### Store wiring (`@aflo/shared`) — the founder implement-list

`AfloStore` gains the native review lifecycle, mirroring the Drizzle
semantics (findRecord/findActor org checks, kernel-decided legality, audited
denials, mutation + `createEvent` outbox + `audit()` together):

- **Types** (`domain/types.ts`, mirroring migrations 0009+0010 field-for-field,
  camelCase/ISO): `ReviewItem`, `ReviewDecisionRecord`, `Playbook`,
  `PlaybookVersion` (+ append-only `reviewHistory` where the owner override
  is VISIBLE), `WorkflowDiscoveryItem`. `Organization` gains
  `allowSingleOperatorPlaybookOverride` (default **false**, including the
  Golden Key seed).
- **Methods:** `createReviewItem` (blocked-envelope gate — non-empty
  `prohibitedActionsDetected` → audited `RVC_BLOCKED_ENVELOPE` denial, the
  item is NEVER created; org-scoped 5-tuple open-uniqueness enforced;
  risk/role floors from `resolveReviewPolicy`, raisable only),
  `submitReviewItem` (`submittedAt` stamps ONLY on FIRST entry into
  awaiting_review — the #92 F2 lesson), `assignReviewer`
  (organization_admin+ per the founder matrix), `recordReviewDecision` (THE
  single decision entry point: `canReview` → `applyReviewDecision` → append
  decision record + move head atomically, mirroring
  `recordDecisionAndTransition`; high-risk self-review denied; escalation
  raises the floor one rank with the owner ceiling; **deferral records a
  structured decision and, per the kernel, lands in the terminal `deferred`
  state (ADR-0034) — escalation is the decision that changes no state**),
  `publishReviewItem` (kernel legality → `canPublishReviewItem` floor →
  stale-artifact check; a stale denial is audited
  `review.publish_denied_stale`/`RVC_STALE_ARTIFACT` and the item stays
  `approved`), `withdrawReviewItem` (author or organization_admin+, open
  states only), `supersedeReviewItem` (system-invokable replacement path:
  new item for the changed version + `supersededByReviewItemId` back-link),
  `recordReviewOutcome` (published items only, vocabulary-validated),
  `createPlaybookDraft`, `savePlaybookVersion` (draft-only content mutation
  behind `validatePlaybookContent`), `transitionPlaybookVersion` (through
  `canActOnPlaybookVersion` + `contentBlocksApproval` on approve AND publish
  — the ADR-0038/0041 boundary, not weakened; publish supersedes the prior
  published version + moves `currentVersionId` in the same operation; a used
  owner override is recorded in the version's review history AND audited
  `playbook.owner_override`), `raiseWorkflowDiscoveryItem`,
  `resolveWorkflowDiscoveryItem`.
- **Role bridge (the §6 trap):** one pure exported function
  `reviewerRoleForMemberRole` maps the store's member-role vocabulary onto
  `ReviewerRole`; every other vocabulary (auth `staff_advisor`, `client`,
  `partner_viewer`, garbage) → null. Platform Admin holds NO tenant
  membership, so it is structurally excluded from decisions and publication
  (test-asserted).
- **Projections (founder matrix, Client row):** `staffReviewQueue` (full
  metadata) vs `clientPublishedReviews` — ONLY published items, ONLY
  client-safe fields (artifact type/ref, published date,
  outcome-acknowledgment), built as a fresh object literal so drafts,
  rejected items, reason codes, reviewer identity, decision history,
  confidence, and risk class are STRUCTURALLY excluded (Object.keys-asserted
  at runtime). `reviewMetrics` derives the ADR-0040 read-model from the raw
  records on every call.
- **Events + audit:** 11 new catalog events (`ReviewItemCreated/Submitted`,
  `ReviewDecisionRecorded`, `ReviewItemPublished/Superseded/Withdrawn`,
  `ReviewOutcomeRecorded`, `PlaybookVersionSaved/Published`,
  `WorkflowDiscoveryRaised/Resolved`) on 3 new aggregates (`review_item`,
  `playbook`, `workflow_discovery_item`); payloads carry ids/digests/reason
  codes ONLY — never artifact bodies. Audit actions as briefed
  (`review.created/submitted/assigned/decided/published/superseded/withdrawn/
  outcome_recorded/transition_denied/decision_denied/publish_denied_stale`,
  `playbook.version_saved/version_published/owner_override/transition_denied`,
  `discovery.raised/resolved`) plus the store's denial-precision additions
  `review.creation_denied` (blocked envelope + open-tuple conflicts),
  `review.assign_denied`, `review.publish_denied` (role floor),
  `review.withdraw_denied`, `review.outcome_denied`, `playbook.created`,
  `playbook.version_transitioned`, `discovery.transition_denied` — every
  material denial is audited, never a silent no-op.
- **Seeds:** six synthetic ReviewItems across states (draft,
  awaiting_review incl. an escalated admin-floor item, approved, published
  with a recorded outcome, rejected) and six queues, with four consistent
  decision-log records. Every seeded digest is the REAL sha256 of the
  canonical string `AFLO-SYNTHETIC-ARTIFACT::<artifactId>::v<version>` —
  precomputed literals (the module is client-bundled; no node:crypto) and
  test-recomputed. No real PII; demo-marker conventions respected.

## Explicitly OUT of scope (deferred by design)

**The domain bridges — ReviewItem shadow-writes for
roadmap/report/education/referral/readiness (design brief §1) — follow in the
next Workstream A slice.** The founder's A PR-5 implement-list covers the
NATIVE review lifecycle; bridges land with the workflow slices so each
bridged type ships with its lockstep mapping tests. Nothing in this PR blocks
them: for bridged artifact types the DOMAIN status remains authoritative
(ADR-0034's authority statement governs), and the store's native surface
never touches the existing domain workflows.

## Consequences

- **Tests: 151 rules (+15), 280 shared (+31), 283 database (+9).** New
  coverage: the seven concierge criteria one-by-one + the informational
  passthrough; the publication floor matrix; the full
  `canActOnPlaybookVersion` matrix incl. both separation rules, the
  owner-override permit chain, and the null-role total denial; migration
  0010 on PGlite (non-superuser) — same 5-tuple twice-open → unique
  violation, same tuple in a DIFFERENT org → allowed, terminal + new open
  same tuple → allowed, new version while old open → allowed, snapshot-chain
  guard; the stale-publication chain (approve digest D1 → publish D2 denied,
  state stays approved → supersede + fresh item for v2 → publishable) at
  BOTH layers; blocked-envelope; F2 anchor; projection structural exclusion
  via Object.keys; platform-admin structural exclusion; seed-digest
  recomputation; metrics derivation from seeds.
- The existing exact-table policy test and the kernel table were updated
  TOGETHER (comment-level only — values unchanged) to record decision 1 as
  founder-resolved rather than provisional.
- ADR-0041's "uq_review_items_open is global, not org-scoped" known gap is
  CLOSED by migration 0010.
- Live Neon apply stays credential-gated (`db:migrate`); everything here is
  PGlite-proven on the exact production SQL.
- One brief-wording note, resolved in the kernel's favor: the implement-list
  phrase "deferral records a decision without a state change" conflicts with
  the accepted kernel/ADR-0034, where `deferred` is a terminal STATE and
  ESCALATION is the stateless decision. The store follows
  `applyReviewDecision` verbatim (deferral → terminal `deferred`; a
  resumption is a NEW linked item), keeping one architecture.
