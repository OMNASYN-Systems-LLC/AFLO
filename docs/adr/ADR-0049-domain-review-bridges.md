# ADR-0049: Domain → Review Center bridges — roadmap + quarterly-report shadow ReviewItems

## Status

**Accepted** — 2026-07-23 (Workstream A, domain-bridges slice 1; implements
the section ADR-0043 explicitly deferred: "The domain bridges — ReviewItem
shadow-writes … follow in the next Workstream A slice")

## Context

The Review Center (ADR-0034 kernel, ADR-0043 store wiring, ADR-0045 UI) ran
only its NATIVE lifecycle: `transitionRoadmap` (roadmap.v1.0.0) and
`transitionReport` (report.v1.0.0) moved their domain rows without any
ReviewItem, so roadmaps and quarterly reports — two of the founder's ten
review queues — never appeared in the Human Review Center, and the seeded
items that CLAIMED those artifact types were unmoored from their domain rows.

Bridging is the design brief's §6.5 governing hazard — the
**two-architectures failure mode**: a bridged artifact holds state twice
(`roadmaps.status` + `review_items.state`), and any path that can move one
without the other manufactures disagreement between two systems of record.

## Authority (ADR-0034, restated verbatim — governs every bridge)

**Domain status authoritative for bridged types; ReviewItem authoritative for
native types.** A bridged ReviewItem is a same-mutation SHADOW derived from
the domain transition — never a second decision surface.

## Decision

### Pure mappings (`packages/shared/src/store/review-bridges.ts`)

Bridged types this slice: `roadmap_draft` (shadows `roadmaps` rows) and
`quarterly_report` (shadows `reports` rows) — `BRIDGED_ARTIFACT_TYPES` /
`isBridgedArtifactType`.

`reviewStateForRoadmapStatus` (roadmap.v1.0.0 → review_center.v1.0.0):

| roadmap status | shadow state      |
| -------------- | ----------------- |
| `draft`        | `draft`           |
| `staff_review` | `awaiting_review` |
| `approved`     | `approved`        |
| `published`    | `published`       |
| `archived`     | `superseded`      |

`reviewStateForReportStatus` (report.v1.0.0 → review_center.v1.0.0):

| report status      | shadow state      |
| ------------------ | ----------------- |
| `draft`            | `draft`           |
| `ready_for_review` | `awaiting_review` |
| `published`        | `published`       |

Every domain status maps; `null` only for unknown input (cast-hardening).
Neither domain kernel was modified.

### How each domain move walks kernel edges (verified against the ACTUAL allow-list)

The review kernel has **no return edges** — `awaiting_review → draft` and
`approved → draft` do NOT exist (the brief's contrary claim was checked
against the allow-list and rejected; a lockstep test now proves their absence
rather than assuming it). The walks:

- **Forward** (`RM_SUBMITTED`, `RM_APPROVED`, `RM_PUBLISHED`,
  `RP_SUBMITTED`): one legal spine edge per step
  (`draft→awaiting_review→approved→published`).
- **Report publish carry-through** (`RP_PUBLISHED`): report.v1.0.0 has no
  `approved` intermediate, so ONE `transitionReport` call applies TWO legal
  kernel edges atomically — `awaiting_review→approved` (append-only decision
  record `approved_unchanged`/`RVD_ACCURATE` stamped to the ACTING staff
  member) then `approved→published`. `report.v1.0.0` gains no state.
- **Regression** (`RM_RETURNED`, `RM_REOPENED`, `RP_RETURNED` — all target
  shadow `draft`): realized through the kernel's own revision path — the open
  shadow is SUPERSEDED and a NEW linked draft item is minted
  (`previousReviewItemId`/`supersededByReviewItemId` both ways) in the same
  mutation. The next domain submission REUSES that open item — never a third.
- **Archive** (`RM_ARCHIVED` from `draft` or `published`): a single legal
  `X→superseded` edge, `supersededByReviewItemId` **null** (no replacement —
  `ReviewItemSupersededPayload.supersededByReviewItemId` widened to
  `string | null` for exactly this case).
- **Published domain rows cannot regress** (no such domain edges exist), so
  no illegal shadow move is ever requested — lockstep-tested.

### The §6.5 mitigations → where each is enforced and tested

| Mitigation                                                       | Enforcement                                                                                                                                                                                                                                                                                             | Test                                                                                                                                                             |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (a) ONE store method performs both writes in one mutation        | `syncBridgedShadow` runs INSIDE `transitionRoadmap`/`transitionReport`, after the domain kernel allows and the domain row mutates; shadow events ride the same result's `emittedEventIds`                                                                                                                 | `store-review-bridges.test.ts` lifecycle walks observe domain row + shadow after every single call                                                                |
| (b) shadow transitions DERIVED only; public APIs deny direct use | pure mappings in `review-bridges.ts`; `createReviewItem`, `submitReviewItem`, `recordReviewDecision`, `publishReviewItem`, `withdrawReviewItem`, `supersedeReviewItem` all deny bridged items — audited `review.bridged_direct_denied`, reason `RVC_BRIDGED_ARTIFACT`, denial code `BRIDGED_ARTIFACT` | `store-review-bridges.test.ts` "bridged guard" (all six methods incl. the author and the null-actor system path; nothing mutates; isolation precedence retained) |
| (c) lockstep — every mapped pair legal in BOTH machines          | the walk uses `reviewItemTransition` per edge and fails closed on drift                                                                                                                                                                                                                                  | `review-bridges.test.ts` LOCKSTEP block: every allow-listed domain move × its full derived edge path; no-return-edges proof; C1 birth-state check on minted legs |
| (d) invariant scan after every bridged transition                | shadow written in the same mutation, so the scan can never observe a half-moved pair                                                                                                                                                                                                                     | `assertShadowConsistency` (state = mapping(domain status), digest = canonical digest, ≤1 live shadow per row, org-scoped open 5-tuple unique) after EVERY move    |

### Shadow identity, provenance, and authorization

- **`artifactVersion`** = `BRIDGED_ARTIFACT_REVISION` (`"1"`): neither domain
  row carries a version column and the store has NO content-edit path for
  either (documented choice — a monotonic revision fixed at "1" for the row's
  lifetime). A future domain edit path MUST bump the revision and supersede
  the open shadow (founder decision 3: a new artifact version requires a new
  review).
- **`artifactDigest`** = sha256 of ONE canonical serializer per type
  (`canonicalRoadmapSerialization` / `canonicalReportSerialization`): stable
  key order, domain-separated prefixes, review-relevant content only (ids,
  enums, title/highlights/focus — the reviewed content the row itself holds).
  Workflow position (`status`) and stamps (`approvedAt`, `publishedAt`,
  `createdAt`, `generatedAt`) are EXCLUDED so the digest is stable across
  workflow transitions. Only the digest is stored — never the content.
- **Lazy creation:** a row that never had a shadow gets one on its first
  bridged transition, born `draft` or `awaiting_review` ONLY (the C1
  birth-state gate holds structurally); a mid-workflow first transition
  births `awaiting_review` and walks forward. Archiving a never-shadowed row
  creates nothing. `submittedAt` keeps first-entry semantics per item.
- **Provenance:** roadmap shadows carry the roadmap's author
  (`createdByStaffId`) and `aiRunId`; report shadows are system-authored
  (`createdByStaffId: null` — reports are generated deterministically from
  recorded facts). `ruleVersionsUsed` records the domain kernel version.
- **Authorization is INHERITED from the domain workflow.** The bridge applies
  no `canReview`/`canPublishReviewItem` — those gate native items. That is
  what "domain status is authoritative" means: `transitionRoadmap` /
  `transitionReport` remain the (org- and actor-checked) decision surfaces,
  and the shadow may never disagree with them. The stale-publish check is
  likewise native-only — a live shadow is never stale by construction
  (`currentArtifactStateFor` in the web demo registry reflects this).
  - **Founder-visible consequence (authority asymmetry).** A concrete
    difference follows: a plain Staff/Advisor **can** publish a high-risk
    `quarterly_report` (or roadmap) shadow through `transitionReport` /
    `transitionRoadmap`, because those domain kernels authorize it — whereas
    a NATIVE high-risk review item requires `organization_admin+` under
    `canPublishReviewItem` (founder A PR-5 matrix, "Staff cannot publish
    high-risk artifacts"). This is intentional and charter-compatible (staff
    action IS the human approval and the shadow records who acted), but the
    two surfaces do not share one publish floor. If the founder wants the
    matrix floor to bind bridged reports/roadmaps too, that is a deliberate
    future change to the domain kernels' publish authorization — not a bridge
    concern — and is called out here so the asymmetry is not discovered by
    surprise.
- **`assignReviewer` and `recordReviewOutcome` are permitted-but-inert on
  bridged shadows** (they carry no `state` move, so no two-architectures
  divergence is reachable): outcome recording is legitimate moat data; a
  reviewer assignment is advisory metadata the domain transition ignores.
  Only the six state-moving review APIs deny bridged types.
- **Queue completeness is lazy (seed vs runtime).** Seeded open domain rows
  carry their shadow; a domain row created at RUNTIME in `draft` gets its
  shadow on its FIRST transition (lazy creation), so a brand-new draft
  roadmap/report is not yet in the review queue. The shadow-consistency
  invariant asserts shadow→domain agreement (no divergence); a future slice
  may mint the draft shadow at creation for domain→shadow queue completeness.

### Kernel + catalog changes (additive only)

- `@aflo/rules` review-center reason-code catalog: `RVC_BRIDGED_ARTIFACT`
  added as a documented store-surface denial code (the `RVC_BLOCKED_ENVELOPE`
  precedent). **No machine edges changed; roadmap.v1.0.0 and report.v1.0.0
  untouched.**
- Events reused, nothing new: `ReviewItemCreated/Submitted`,
  `ReviewDecisionRecorded`, `ReviewItemPublished`, `ReviewItemSuperseded`
  (payload's `supersededByReviewItemId` widened to nullable). Audit actions
  reused (`review.created/submitted/decided/published/superseded`) plus the
  one new denial action `review.bridged_direct_denied`.

### Seeds (synthetic) + demo surfaces

- Every bridged domain row in an OPEN workflow state seeds a consistent
  shadow: `rvi-pryor-roadmap` (draft↔draft), NEW `rvi-ramirez-roadmap`
  (staff_review↔awaiting_review), `rvi-solomon-report` RECONCILED to the
  mapping (ready_for_review↔awaiting_review@rev 1 — it previously claimed
  `approved`@v2, which the invariant forbids), NEW `rvi-okafor-report`
  (draft↔draft). Bridged seed digests are the REAL canonical-serializer
  digests (precomputed literals; recomputed and asserted by the seed test).
  PUBLISHED seed roadmaps/reports predate the Review Center and carry no
  shadow — lazily bridged on their next transition, never backfilled.
- The stale-publish demo (founder decision 4) moved to a NATIVE item:
  `rvi-solomon-summary` (`financial_summary`/`fs-c-solomon-2026-07`@v2,
  approved-with-edits; demo registry holds current v3) — a bridged item can
  no longer demonstrate direct publication because direct publication is now
  denied on bridged items. Web e2e + the demo artifact registry updated
  accordingly; decision-log seed repointed (`rvd-solomon-summary-1`).

## Consequences

- **Tests: 151 rules (unchanged), 348 shared (+41: 12 pure bridge tests, 12
  store bridge tests, reworked review-center/roadmap/report suites), 371
  database (unchanged), 9 web (unchanged).** Full gates green: workspace
  typecheck + lint, demo-marker guard, web production build.
- Roadmaps and quarterly reports now appear in the Review Center queues with
  full provenance, and a domain-published report/roadmap reaches
  `clientPublishedReviews` through its shadow — without ever adding a second
  decision surface.
- The Review Center UI's decision/publish controls on a bridged item return
  the audited `RVC_BRIDGED_ARTIFACT` denial with a staff-readable message
  ("move the roadmap/report itself"); hiding those controls for bridged items
  is UI polish for a later slice.
- The durable layer (`DrizzleReviewItemRepository`) does not yet enforce the
  bridged guard or perform shadow-writes — the store's semantics are the
  specification for the committed durable domain-transition slice (the
  ADR-0043 precedent: store first, Drizzle mirrors).
- Education, referral, and readiness bridges follow in later slices with the
  same mitigation set; `BRIDGED_ARTIFACT_TYPES` is the single roster they
  extend.
