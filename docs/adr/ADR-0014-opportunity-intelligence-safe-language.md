# ADR-0014: Opportunity Intelligence — Safe-Language Boundary & Review Gates

## Status

**Accepted** — 2026-07-19 (delivery-order item #19: Opportunity & Risk Intelligence registry; roadmap §4)

## Context

The partner-orchestration roadmap (§4) calls for an Opportunity & Risk Intelligence feed: public programs, benefit/rate/tax changes, and consumer-protection settlements that may be relevant to a client. It sets a **hard language rule** — the system may say *"a public settlement may relate to an account in your profile; review the official eligibility terms"*, but must **not** say *"you are eligible to eliminate $3,000 of debt"* unless eligibility has been **formally verified** — and requires trusted-source citation, jurisdiction/effective dates, expiration handling, and **human review for legal or claims-related notices**.

The hazard is unique to this domain: surfacing a public notice can, if phrased even slightly wrong, read as legal advice, an entitlement, or a guaranteed benefit. The boundary has to be **mechanical**, not editorial.

## Decision

**Activate `@aflo/opportunity-intelligence` (`opportunity.v1.0.0`) as a pure, deterministic library** — no AI, no external calls, seed data only:

1. **Trusted-source registry.** A frozen `TRUSTED_SOURCES` list of official bodies. Every `OpportunityNotice` must cite one; `validateOpportunityNotices` fails a notice that cites anything else.
2. **The safe-language boundary is code.** `validateOpportunityLanguage(text)` returns the codes of every prohibited pattern (second-person eligibility / qualification / entitlement / approval claims, guarantees, and any dollar figure). `toClientSafeSummary(notice)` composes the ONLY client-facing text from a **fixed hedged template** ("…may relate to your profile — review the official eligibility terms…"), includes the notice title only after validating it, and **throws** rather than emit an unsafe claim.
3. **Matching is surface-worthiness, never eligibility.** `matchNoticeToProfile` decides whether a notice is worth showing from jurisdiction, freshness, and goal alignment, fail-closed. A `relevant` result is explicitly "worth a look at the official terms", not a determination. `verifiedEligibility` is always `false` at the registry level; a real per-client verification is a separate, staff-recorded fact out of this package's scope.
4. **Human-review gate for legal/claims notices.** `REVIEW_REQUIRED_CATEGORIES` (`consumer_settlement`, `regulatory_notice`) and `requiresHumanReview(notice)` mark notices that must never reach a client without prior staff review; `matchNoticeToProfile` propagates `requiresReview`.
5. **CI guard.** `validateOpportunityRegistry()` asserts the live seed is sound (trusted source, current rule version, no verified-eligibility, renders client-safe); negative-fixture tests prove the validator detects each violation class.

## Consequences

Positive: the roadmap's language rule is enforced by a validator and a template, not by reviewer diligence; a notice cannot be rendered client-safe if its title or message trips the boundary; legal/claims notices are gated by category; matching cannot be mistaken for an eligibility decision because it returns surface-worthiness with reason codes and carries no amount.

Negative / accepted: the client-facing message is intentionally generic (category + jurisdiction + "review the official terms") rather than richly descriptive — safety over specificity; per-notice tailored copy would need its own review path. The seed notices are illustrative and cite real bodies for realism; a live feed (ingesting from the trusted sources) is a later, reviewed phase, as is store/UI wiring. The dollar-figure prohibition is blunt (any `$\d` in client-facing text) — deliberately so, since a specific amount in a pre-verification pointer reads as an entitlement.

## Alternatives Considered

1. **Free-text summaries reviewed by staff before send** — rejected as the *primary* control: it relies on human diligence for every notice. The template + validator make the safe path the default; staff review is an additional gate for legal/claims categories, not the only guard.
2. **Let matching output an eligibility score/decision** — rejected: any "you are (probably) eligible" signal is exactly what the roadmap forbids. Matching outputs surface-worthiness only.
3. **Allow amounts when `verifiedEligibility` is true** — deferred: formal per-client verification is out of scope here; until it exists as a reviewed, recorded fact, the client-facing path stays strictly hedged and amount-free.
