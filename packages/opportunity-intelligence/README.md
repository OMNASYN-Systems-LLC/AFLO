# @aflo/opportunity-intelligence

Opportunity & Risk Intelligence (`opportunity.v1.0.0`) — a deterministic registry of public programs, benefits, tax/rate updates, and consumer-protection notices that **might** be relevant to a client, and the guardrails for surfacing them safely (roadmap §4). No AI, no external calls; seed data is illustrative/synthetic.

## What AFLO does — and never does

AFLO's role is to surface a **hedged, cited pointer** to an official source. It **never** determines eligibility, promises a benefit, or states an amount a client will receive.

> ✅ "A public program may relate to your profile. Review the official eligibility terms at the source before acting."
>
> ⛔ "You are eligible to eliminate $3,000 of debt." — prohibited unless eligibility is formally verified.

## Pieces

- **Trusted-source registry** (`TRUSTED_SOURCES`) — only vetted official bodies (CFPB, HUD, IRS, a state HCD) may back a notice; a notice citing anything else fails `validateOpportunityNotices`.
- **`OpportunityNotice`** — publication/effective/expiration dates, jurisdiction, eligibility *fields* (what to check, not a determination), source citation, rule version. `verifiedEligibility` is always `false` at the registry level.
- **Safe-language boundary** (`validateOpportunityLanguage`, `toClientSafeSummary`) — rejects second-person eligibility/entitlement/guarantee claims and dollar figures; the only client-facing text is a fixed hedged template, and rendering throws rather than emit an unsafe claim.
- **Profile matching** (`matchNoticeToProfile`) — deterministic surface-worthiness from jurisdiction, freshness, and goal alignment; fails closed. It is **not** an eligibility determination.
- **Human-review gate** (`requiresHumanReview`, `REVIEW_REQUIRED_CATEGORIES`) — legal/claims notices (settlements, regulatory) never surface to a client without prior staff review.
- **`validateOpportunityRegistry`** — the CI guard asserting every notice cites a trusted source, carries the current rule version, asserts no verified eligibility, and renders client-safe.

Store/UI wiring is a follow-up. Advancing from seed data to a live source feed is a later, reviewed phase.
