# ADR-0007: Partner-Orchestration Boundary

## Status

Accepted — 2026-07-18 (founder decision; see `docs/product/PARTNER_ORCHESTRATION_ROADMAP.md`, which ranks above the Product Charter)

## Context

The partner-ecosystem expansion (credit-builder products, secured cards, bureau data, opportunity intelligence, education) could be read as a mandate to build regulated financial capabilities into AFLO itself. Doing so would turn a small team into the operator of several regulated businesses — lending, card programs, custody, insurance — each with its own licensing, compliance, and sponsor-bank obligations.

The founder-approved Partner-Orchestration Roadmap (2026-07-18) resolves this: AFLO's advantage is the orchestration loop — understand what the user needs next, explain why, prepare them, route them to an appropriate licensed provider, and measure whether the outcome improved their readiness. This ADR fixes that boundary in architecture so future modules cannot drift across it.

## Decision

### 1. Build vs. orchestrate

- **AFLO builds and owns:** readiness scoring and lifecycle-stage logic, credit intelligence, goal/roadmap and workflow orchestration, contextual education, user consent, audit trails, partner eligibility rules and comparison, referral routing, and outcome tracking.
- **Licensed partners own (AFLO integrates, never builds):** lending and loan origination, card issuance, bureau reports and scores, bank-account and deposit custody, payment processing, investment accounts, insurance and claims, and all regulated execution.

### 2. Five future packages as documented stubs

Add `packages/partner-marketplace`, `packages/credit-data`, `packages/opportunity-intelligence`, `packages/academy`, and `packages/embedded-finance` as documented stubs now, implemented in phases per the roadmap. `embedded-finance` must remain **isolated from the readiness engine** — no import path or data flow may allow commercial compensation to influence a user's readiness result.

### 3. Partner Neutrality Engine (required guardrail)

Every partner recommendation stores eight fields:

1. Why this option was shown
2. All eligible alternatives
3. Compensation AFLO may receive
4. Whether a non-commercial option exists
5. Estimated user cost
6. Key risks
7. Partner eligibility criteria
8. Whether staff reviewed it

A partner's commission must **never** affect the readiness calculation, and must **never** affect ranking without transparent labeling.

### 4. Disabled-until-validated gates

| Capability | Unlock condition |
|---|---|
| Real affiliate integrations | Reviewed commercial agreements |
| Bureau data access | Provider contract + compliance review (FCRA permissible purpose, consent, retention) |
| Embedded credit-builder applications | Commercial + compliance validation |
| Card issuance (any branding depth) | Sponsor-bank program approval + full compliance review |
| Deposit/savings-linked products | Custody partner + compliance review |
| Interchange revenue modeling | Documented program economics from a partner |

Until a gate clears, the module stays a documented stub with mock providers only in code.

### 5. Provider-neutral credit-data interface

`credit-data` must never be architected around one bureau's proprietary response schema. Bureau providers (Experian Partner Solutions, Array, or another approved provider) plug in behind an adapter that produces a normalized AFLO credit model, feeding deterministic rules and then the credit intelligence agents.

### 6. Hard rules

- An internal readiness score is never presented as if it were a bureau credit score.
- Academy course completion never unlocks regulated financial products; it may unlock platform features, badges, coaching, or discounts only.
- No partner names or compensation assumptions are hardcoded in **code** before actual commercial agreements are reviewed (mock providers only). In docs and projections, claimed affiliate economics (e.g. acquisition payments, revenue shares, interchange multiples) are unverified commercial estimates and must never be stated as facts; naming candidate providers for planning purposes is permitted.

## Consequences

Positive:

- AFLO stays one company with one regulatory surface (its own platform), while users still experience a unified product through orchestration.
- The neutrality record makes every recommendation auditable and defensible, aligned with the "every material state change is auditable" rule.
- Stub packages fix module boundaries now, so phased implementation is additive rather than a restructuring.
- Gates give a checklist-verifiable answer to "can we ship this integration yet?" — the default is no until documented validation exists.

Negative / accepted costs:

- V1 partner features run on mock providers only; no real affiliate revenue or bureau data until gates clear.
- The readiness-engine isolation and neutrality-record requirements add schema and review overhead to every partner-facing feature.
- Provider-neutral adapters cost more up front than coding directly against one bureau's API.

## Alternatives Considered

1. **Build regulated capabilities in-house** (lending, card program, custody, monitoring, insurance). Rejected: this is the "five regulated companies" problem — each capability carries its own licensing, sponsor-bank, and compliance burden that would consume the company before the orchestration value is proven.
2. **Single-bureau-coupled integration** (architect `credit-data` around one bureau's schema for speed). Rejected: creates provider lock-in; the roadmap requires that bureau providers be swappable behind a normalized model.
3. **Immediate embedded finance** (ship embedded credit-builder applications and card issuance in V1). Rejected: no commercial contracts or compliance reviews exist yet; the roadmap sequences referrals → embedded applications → co-branded/white-label pilot → branded card, each behind its gate.
