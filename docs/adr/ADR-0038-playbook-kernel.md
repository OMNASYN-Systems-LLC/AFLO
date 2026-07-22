# ADR-0038: Professional Playbook kernel (playbook.v1.0.0)

## Status

**Accepted** — 2026-07-22 (founder directive 2026-07-20 + continuation
2026-07-22, Workstream A slice 2)

## Context

Playbooks are versioned TENANT IP — the codified, reviewable form of a
professional's actual working method — and a core differentiation layer. Two
hard constraints from the directives: playbook versions live under the same
review discipline as every other reviewable artifact (one vocabulary, no
second architecture), and **the founder's actual process is never invented**
("Do not invent Natalia's exact process. Create editable drafts and a
workflow-discovery queue for unresolved decisions.").

## Decision

`packages/rules/src/playbook.ts` — pure, deterministic, three machines:

1. **Version lifecycle.** `PlaybookVersionStatus` IS `ReviewItemState` (the
   Review Center vocabulary re-exported — no drift possible), with its own
   allow-list and `PB_*` codes: `draft → awaiting_review → approved →
   published`; terminals `rejected`/`deferred`/`withdrawn`/`superseded`.
   Same structural guarantees as review_center.v1.0.0: **published is
   reachable ONLY through approved**, terminals never exit, and there is **no
   return-for-edits edge** — a revision is a NEW version (natural for
   append-only versioned content); publishing N+1 supersedes N.
2. **Field provenance — the anti-invention control.** Every one of the 14
   content fields carries exactly one of
   `confirmed`/`assumption`/`discovery_required`/`approved` (continuation
   directive §9, verbatim set). `validatePlaybookContent` enforces an
   exhaustive provenance map plus structural rules (non-empty purpose and
   prohibited actions; trimmed-non-empty entries across every string-list
   field; valid lifecycle stages, trigger kinds — `fact_threshold` triggers
   must name a trimmed-non-empty backing rule id; unique question, action,
   checkpoint, and escalation ids; checkpoint `afterStep` must reference an
   existing action or question id; review checkpoints may only RAISE the
   kernel review floor — a lowering attempt is surfaced as an authoring error
   via `resolveReviewPolicy`, not silently clamped). `contentBlocksApproval`
   lists the `discovery_required` fields that MUST be resolved before
   approval/publication — a draft may carry open questions freely; an
   approved version may never present one as settled process. (`assumption`
   fields do not block: visibly-labeled scaffolding a reviewer explicitly
   accepts.)

   Enforcement boundary: `playbookVersionTransition` is content-blind — the
   STORE (design-brief PR-5) MUST consult `contentBlocksApproval` and deny
   awaiting_review→approved / approved→published while it returns a non-empty
   list. This ADR assigns that responsibility now so the wiring slice cannot
   honestly omit it.
3. **Workflow discovery.** `open → answered → converted` (terminal — the
   answer absorbed into a version, recorded via
   `converted_playbook_version_id` when persistence lands);
   `open → dismissed`; answered/dismissed may reopen. `WD_*` codes.

`packages/shared/src/data/playbook-seeds.ts` — **the 10 initial Golden Key
playbooks as editable 1.0.0 DRAFTS** (High Utilization Recovery, Past-Due
Stabilization, Collections Preparation, Thin Credit Profile, Rental
Readiness, Mortgage Readiness, Emergency Savings, Debt Overload,
Business-Capital Document Readiness, Client Reengagement). Every seed:
provenance is ONLY `assumption` (visibly generic scaffolding) or
`discovery_required` — `confirmed`/`approved` are reserved for the founder's
actual answers; the eight process-specific fields (triggers, question
sequence, escalation, completion evidence, outcome metrics, required
documents, review checkpoints, recommended actions) are `discovery_required`,
each backed by a concrete `WorkflowDiscoveryItem` question — nine questions
per seed covering ALL eight §9 unresolved-decision categories (threshold,
document requirement, escalation condition, communication template, reviewer
role, timing rule, completion evidence, expected outcome; test-enforced
per-category); placeholder values (triggers, escalations, action-ordering
strategies) are labeled "pending discovery" in the text itself;
`contentBlocksApproval` is non-empty for every seed, so none can be approved
or published as-is.

Registry: `playbook.version_transition` / `.content_validation` /
`.discovery` at `playbook.v1.0.0`, lockstep-tested. Vocabulary boundaries:
`requiredDocuments`/action categories are shared-owned strings validated
against their vocabularies at the store boundary (rules cannot depend on
shared); the seed test enforces them today, plus registered-rule-id checks
for `calculations`.

## Consequences

- **18 new rules tests → 136** (full transition matrices for both machines,
  published-only-via-approved + no-return proofs, terminal no-exit,
  fail-closed unknown statuses, validator structural + provenance +
  floor-raising cases, whitespace-entry/duplicate-id/dangling-`afterStep`
  rejection, approval blockers, registry lockstep incl. reason-code
  emission-equality) and **7 new shared tests → 237** (seed
  count/uniqueness/draft status, structural validity,
  never-confirmed/approved, approval blocked with full discovery coverage,
  per-category §9 discovery coverage, TYPED vocabulary +
  registered-calculation checks, visible placeholders).
- Next slices per the design brief: PR-3 feedback + analytics kernels, PR-4
  migration + repositories (playbooks/playbook_versions/workflow_discovery_items
  org-RLS tables), PR-5 store wiring (author/approve authorization — Staff
  author, OA/OO approve, final call founder-flagged in the discovery queue),
  PR-6 Review Center UI.
