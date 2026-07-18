# ADR-0010: Partner-Referral Lifecycle and Neutrality Enforcement

## Status

**Accepted** — 2026-07-18 (founder implementation order #15–#16: tracked partner referrals + partner neutrality)

## Context

ADR-0007 fixed the partner-orchestration boundary — AFLO routes clients to licensed partners and measures outcomes, but never becomes the lender, card issuer, custodian, or bureau — and mandated the **Partner Neutrality Engine**: every partner recommendation must store eight disclosure fields, a partner's compensation must never affect the readiness calculation, and compensation must never affect ranking without transparent labeling. That ADR set the policy; this one implements it as running code in the first partner slice.

Three risks had to be closed in code, not just prose: a referral could be recorded without its neutrality disclosure; compensation could quietly leak into how options are ordered; and the lifecycle could imply AFLO "approved" a partner outcome.

## Decision

**1. Activate `@aflo/partner-marketplace` (`partner.v1.0.0`) with pure, tested primitives** — no partner names or compensation figures hardcoded (ADR-0007):

- **Referral lifecycle** — an allow-list state machine: `suggested → shared_with_client → client_engaged → outcome_recorded`, with `declined` reachable from any non-terminal state; `outcome_recorded` and `declined` are terminal. `ReferralOutcome` values are staff **observations** (`engaged_supported_readiness`, `engaged_no_change`, `not_pursued`) — never "approved" or "accepted", because AFLO does not decide a partner's result.
- **Neutrality engine** — the eight-field `NeutralityRecord` (why shown, eligible alternatives, compensation, non-commercial option exists, estimated user cost, key risks, eligibility criteria, staff reviewed) with `validateNeutralityRecord` (fail-closed: every string non-empty, booleans actually booleans, alternatives an array) and `orderPartnerOptions`, which sorts **non-commercial-first then by name — never by any compensation amount**.

**2. The store gates every referral.** `createReferral` fails closed on a server-verified actor, an active partner in the organization, and — the guardrail — a **complete** neutrality record; an incomplete record is audited and no referral is written. `transitionReferral` is rule-gated (and cannot reach `outcome_recorded`); `recordReferralOutcome` performs that terminal transition and records the staff observation. Creation emits the pre-existing `PartnerReferralCreated` domain event; every transition and denial is audited and organization/actor scoped.

**3. Compensation is structurally kept out of readiness and ranking.** The referral path imports nothing from the readiness engine and writes nothing back to it; the neutrality record's compensation field is disclosure-only. Option ordering has no compensation input by construction.

**4. Synthetic providers only.** The dev partner directory lives in the synthetic dataset with clearly-fictional names and dollar-free, plain-language compensation disclosures. Real partner names and terms enter only behind reviewed commercial agreements (ADR-0007).

## Consequences

Positive: a referral cannot exist without its full neutrality disclosure; the non-commercial option is surfaced first as a first-class outcome; the "outcome" vocabulary can never be read as an approval; the lifecycle and neutrality rules are unit-tested apart from the store; the compensation-into-readiness and compensation-into-ranking risks are closed by construction, not convention.

Negative / accepted: the neutrality record is captured once at creation and is immutable thereafter — correcting a disclosure means a new referral, which is the honest audit trail but adds a step. The UI composes the neutrality record from staff-authored fields (why shown, alternatives, review acknowledgment) plus the selected partner's own disclosures; richer per-referral cost/risk authoring is a later refinement. Referral status transitions are audited but do not emit their own domain events yet (only creation does) — a `PartnerReferralOutcomeRecorded` event is a follow-up when a consumer needs it.

## Alternatives Considered

1. **Neutrality as an optional annotation** — rejected: ADR-0007 makes the eight fields mandatory; an optional record would let referrals ship without disclosure. The store fails closed instead.
2. **Ranking partners by best available terms (which can correlate with compensation)** — rejected: any compensation-correlated sort violates ADR-0007 §3. Ordering is non-commercial-first then alphabetical, with compensation never a sort key.
3. **A generic "referral accepted/approved" outcome** — rejected: AFLO does not approve or guarantee a partner decision; outcomes are staff observations about readiness support, phrased to preclude an approval reading.
