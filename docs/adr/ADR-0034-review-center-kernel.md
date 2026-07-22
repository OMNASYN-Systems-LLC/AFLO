# ADR-0034: Human Review Center kernel (review_center.v1.0.0)

## Status

**Accepted** — 2026-07-22 (founder Strategic Product Differentiation directive
2026-07-20 + continuation 2026-07-22, Workstream A slice 1)

## Context

The founder directed a FIRST-CLASS human-in-the-loop architecture: one unified
review lifecycle over ten artifact queues, with full provenance, structured
decisions, risk-tiered reviewer requirements, and the hard rule that
**high-impact AI output is never client-visible without an authorized human
approval**. A workflow-produced design brief mapped every existing
review/approval surface first, so this kernel BRIDGES the existing per-domain
machines (roadmap.v1, report.v1, document.v1, education review, the @aflo/ai
envelope's `ReviewStatus`) instead of duplicating them — the Review Center is a
coordination layer, not a second system of record.

Naming constraint discovered by the mapping: `review.v1.0.0`, `review.ts`,
`RC_*`, and `ReviewStatus` are already owned by the readiness review gate, the
readiness reason codes, and the @aflo/ai envelope. This kernel therefore uses
**`review_center.v1.0.0`**, **`RVC_`/`RVD_`** prefixes, and
**`ReviewItemState`** — and never re-exports a second `ReviewStatus`.

## Decision

`packages/rules/src/review-center.ts` — pure, deterministic, zero-dependency:

- **States (8):** `draft → awaiting_review → approved → published`; alternate
  terminals `rejected`, `deferred`, `withdrawn`, `superseded` (the continuation
  directive makes `deferred` a terminal STATE — resumption, like rejection
  recovery, is a NEW ReviewItem linked via `previousReviewItemId`, never
  resurrection). The allow-list structurally omits `draft → published` and
  `awaiting_review → published`: **`published` is reachable only through
  `approved`** — the never-publish-unapproved rule is unrepresentable, not
  merely checked. `escalated` is a DECISION, not a state (the item stays
  `awaiting_review` with the reviewer floor raised one rank).
- **Decisions (5):** `approved_unchanged` / `approved_with_edits` / `rejected` /
  `escalated` / `deferred`, applied by `applyReviewDecision` — legal only from
  `awaiting_review`, with **modification pairing** (`approved_unchanged` must
  carry zero recorded modifications, `approved_with_edits` at least one — a
  dishonest feedback record is unrepresentable) and **structured RVD\_ reason
  codes** validated per decision (`REVIEW_DECISION_REASON_CODES`; the edit codes
  double as the feedback engine's edit-category taxonomy).
- **Reviewer policy:** ordered `REVIEWER_ROLES` (`staff < organization_admin <
  organization_owner`); `DEFAULT_REVIEW_POLICIES` maps each of the ten artifact
  types to the continuation directive's risk tier + role floor
  (`partner_referral` is the OO/OA-only queue per AUTHORIZATION_MATRIX §4);
  `resolveReviewPolicy` lets an org override RAISE the floor only (lowering is
  clamped); `canReview` enforces, deny-by-default: org membership required
  (Worker/Platform Admin/unauthenticated → null role → denied) → role must be a
  reviewer role (client/partner_viewer denied) → rank ≥ floor → **high-risk
  separation of duties** (no self-review; system-authored items have no author).
  `escalateReviewerRole` walks the rank ladder with an owner ceiling.
- **Registry:** three entries at `review_center.v1.0.0` —
  `review_center.item_lifecycle`, `.decision`, `.reviewer_policy` — lockstep-
  tested like every kernel. (The registry test's version regex was widened to
  allow underscores, matching the id convention it already had.)

Also folded in: the design brief's doc-only correction — AGENT_BOUNDARIES §8 /
DATABASE_SCHEMA §9.3 described a phantom `not_required` value for
`ai_review_status`; both now match the implemented enum
(`pending_review/approved/rejected/auto_published`), and state explicitly that
`auto_published` ≠ Review Center `published` (it marks below-gate output that
never enters a queue).

## Consequences

- **19 new tests** (115 rules tests total): the full 8×8 transition matrix,
  the forbidden never-paths (published reachable ONLY from approved), terminal
  no-exit proofs, all five decisions incl. modification/reason pairing and
  stay-put escalation, the deny-by-default reviewer policy (null role,
  non-reviewer roles, rank floor, self-review, escalation ceiling), the policy
  table (every artifact type covered; the high tier matches the directive), the
  upward-only override clamp, and registry lockstep.
- **Bridging is next, not here.** Store wiring (ReviewItem shadow-writes for
  roadmap/report/education/referral/readiness, blocked-envelope denial) is the
  brief's PR-5; the playbook kernel (PR-2), feedback + analytics (PR-3), and
  migration 0008 + repositories (PR-4) precede or parallel it. Domain kernels
  keep their vocabularies — a lockstep mapping test lands with the bridges.
- **Authority statement (anti-two-architectures):** for bridged artifact types
  the DOMAIN status remains authoritative and the ReviewItem is a derived
  shadow; for native types (concierge_recommendation, document_interpretation,
  financial_summary, stage_advancement) the ReviewItem state IS the artifact
  state. That sentence governs every later slice.
