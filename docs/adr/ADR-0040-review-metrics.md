# ADR-0040: Review & playbook analytics derivations (Workstream A PR-3)

## Status

**Accepted** — 2026-07-23 (founder directive 2026-07-20 "measurable outcomes"
+ continuation 2026-07-22 analytics priority)

## Context

The founder's analytics list — approval/edit/rejection rates, review time,
action completion, CLIENT RESPONSE, stage advancement, playbook
effectiveness, staff consistency, escalation volume — is the measurement layer of the moat: it is
what turns structured review decisions into workflow, rule, and playbook
improvement. The design brief's rule: metrics are NEVER stored aggregates.

## Decision

`packages/shared/src/store/review-metrics.ts` — pure derivation functions:

- **`reviewMetricsFor(items, decisions, actions)`** → overall + per-artifact
  `DecisionMix` (counts for all five decisions; approval/edit/rejection rates;
  median minutes submission→decision; mean modified fields), escalation
  volume, queue depth (`awaiting_review` count), action completion rate,
  stage-advancement count (completed actions only — aligned with the
  per-playbook rate so the two views cannot disagree), **client response
  rate** (responded/all actions — the founder's client-response dimension),
  per-reviewer `StaffDecisionProfile`s (sorted,
  deterministic), and `PlaybookEffectiveness` grouped by
  `(playbookId, playbookVersion)` (items, published count, action completion,
  stage-advancement rate).
- **Honest-denominator rule:** every rate is `null` when its denominator is
  empty — "no data" is never reported as 0%. Malformed timestamps are
  EXCLUDED from medians (never counted as 0 minutes); orphan decisions are
  excluded from per-type mixes rather than misattributed.
- **Nothing stored:** derivations are O(n) and recomputed on read, so no
  aggregate can ever disagree with the records.
- Input shapes (`ReviewItemMetricInput`, `ReviewDecisionMetricInput`,
  `ActionOutcomeMetricInput`) use the review_center kernel vocabularies and
  are the analytics CONTRACT the migration slice's tables must satisfy.

**Data governance (module doc, verbatim intent):** review-feedback data is
used ONLY for analytics, rule improvement, prompt improvement, workflow
improvement, and QA. It is NEVER used for uncontrolled external-model
training; any future training use requires an explicit founder-approved
governance decision.

## Post-review hardening (adversarial review, same day)

The review's blocker was founder fidelity: the client-response dimension was
absent and the ADR recited the founder list without it. Fixed by
IMPLEMENTING it (`clientResponded` on the action input; overall and
per-playbook `clientResponseRate`), not deferring. Also folded in: playbook
grouping carries identity in the group value (separator-looking ids can
never merge or truncate rows — test-proven), `stageAdvancementCount` aligned
to completed-actions-only, `byArtifactType` keys sorted deterministically.
Accepted-and-noted: negative review durations are silently excluded from
medians (an exclusion counter is a later nicety); `reviewItemId` on actions
is carried for the write-path join integrity that lands with persistence
(PR-4/PR-5) — attribution at this layer trusts the action's declared
playbook.

## Consequences

- **12 new tests → 249 shared tests**: null-not-zero empty denominators,
  orphan/malformed exclusion, exact rate/median math (even-count median),
  per-type and per-reviewer grouping determinism, queue depth, action
  completion + advancement, per-version playbook effectiveness incl.
  null-safe rates, and playbook-less actions contributing overall only.
- The Review Center UI (PR-6) renders exactly this read-model; the migration
  slice (PR-4) persists records these types project from.
