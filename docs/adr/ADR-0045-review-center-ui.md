# ADR-0045: Human Review Center staff UI — thin rendering over store authority

## Status

**Accepted** — 2026-07-23 (Workstream A PR-6; founder directive 2026-07-20:
human-in-the-loop is FIRST-CLASS workflow architecture — a Human Review Center
with per-artifact review queues, full provenance, structured decisions, and
outcome tracking)

## Context

ADR-0043 wired the Review Center lifecycle into the shared store:
`createReviewItem` / `submitReviewItem` / `assignReviewer` /
`recordReviewDecision` / `publishReviewItem` / `withdrawReviewItem` /
`supersedeReviewItem` / `recordReviewOutcome`, the `staffReviewQueue` vs
`clientPublishedReviews` projections, and `reviewMetrics`. Every gate — the
review kernel's state machine and decision pairing, `canReview` (role floor +
high-risk self-review separation), the assignment narrowing
(`RVC_NOT_ASSIGNED_REVIEWER`), `canPublishReviewItem` (Staff can never publish
high-risk artifacts), and the stale-artifact invariant
(`RVC_STALE_ARTIFACT`) — lives in the store/kernels and is audited there. No
staff surface existed to see the queues, provenance, or decisions.

## Decision

Build the staff Review Center as a **pure rendering layer** over the store, in
the demo runtime (mock store, credential-free), under the existing staff
shell:

- **Routes.** `/reviews` (queue index: the ten founder-directed artifact-type
  queues with counts by state and risk, state/type/risk filters, the queue
  table, and an analytics strip from `reviewMetrics`) and `/reviews/[id]`
  (item detail: full provenance panel, append-only decision history from
  `reviewDecisionsFor`, review actions, and the client-projection preview).
- **No authorization logic in the UI — none.** Every mutation is a server
  action (`apps/web/src/app/(app)/reviews/actions.ts`) that resolves the
  actor from the server-side session, calls the store method, and returns the
  store's result as a serializable `ReviewActionState`. Denials (role floor,
  self-review, not-assigned, stale artifact, kernel transitions) are rendered
  inline verbatim — message + reason code — never pre-empted, re-implemented,
  or hidden by client-side role checks. The only UI-side narrowing is
  STATE-shaped (a decision form renders only for `awaiting_review`, publish
  only for `approved` — mirroring the kernel's legal moves) and UX assistance
  (reason-code options filtered to the kernel's declared decision↔RVD_*
  pairs); the store re-validates everything.
- **Decision form.** The five structured decisions with the kernel's RVD_*
  reason codes (labels from `REVIEW_DECISION_REASON_CODES` descriptions),
  optional detail, and edited-field NAME capture for `approved_with_edits` —
  names only, never values, matching `RecordReviewDecisionInput` exactly; no
  digests are fabricated in the UI.
- **Publication + the stale-artifact denial.** `publishReviewItemAction`
  states the artifact's CURRENT version + digest from the server-side **demo
  artifact source** (`apps/web/src/lib/review-artifacts.ts`), which recomputes
  the canonical synthetic digest exactly the way the seed data does
  (`AFLO-SYNTHETIC-ARTIFACT::<artifactId>::v<version>`, node:crypto,
  server-only). The registry records one revised artifact (`qr-solomon-q2` →
  v3) so the founder's decision-4 chain is demonstrable end to end: the
  approved v2 review is stale, publication is denied `RVC_STALE_ARTIFACT`
  with a DISTINCT rendering ("Artifact changed since approval — new review
  required"), and the item stays approved. Current versions/digests never
  come from the browser.
- **Client-projection preview.** The detail page renders exactly what
  `clientPublishedReviews` serves for the item's client — or "Not visible to
  the client" — so the client-safe boundary (reviewer identity, confidence,
  risk class, reason codes, decision history structurally excluded) is
  visible to staff, not just asserted in tests.
- **Honest analytics.** The strip renders `reviewMetrics` with its null
  denominators as "—" (never 0%) and shows the decision count the approval
  rate is computed over.
- **Artifact bodies never appear.** The UI renders references, versions,
  truncated sha256 digests, source-fact ids + freshness timestamps, rule
  versions, AI run/model/prompt provenance, and playbook provenance — the
  coordination-layer contract (ADR-0034/0043) unchanged.
- Brand and visual rules respected: ΛFLO display brand in UI copy, AFLO in
  identifiers; the restrained obsidian/ivory/gold/emerald/slate system; no
  new demo-identity markers (session access stays behind `lib/data.ts`).

## Out of scope (deferred by design)

Withdraw/supersede controls, review-item creation, outcome recording, and the
submit-draft action have store surfaces but no UI this slice — they belong to
the authoring/orchestration flows (domain bridges, next Workstream A slices).
The read surface already renders their results (superseded/withdrawn states,
previous/superseded-by links, outcomes on published items).

## Consequences

- Playwright critical paths (`apps/web/e2e/review-center.spec.ts`, serial,
  demo runtime): seeded queue counts + honest metrics; provenance rendering
  (including "Deterministic — no model confidence" for null confidence); an
  approve decision moving `awaiting_review → approved`; publish success
  filling the client projection; the stale-artifact denial leaving the item
  approved; and the client-preview exclusion of internal fields while staff
  still see them elsewhere on the page.
- When the Neon-backed store lands behind the same shapes (ADR-0002/0043),
  these pages swap data sources without change — they depend only on the
  store surface and its result types.
- The demo artifact source is prototype-only: real artifact currency arrives
  with the domain bridges, which will supply version + digest from the
  bridged domain records.
