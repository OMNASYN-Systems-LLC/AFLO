# AFLO Partner-Orchestration Roadmap

> **Status:** Authoritative founder decision, 2026-07-18. Ranks above the Product Charter in the source-of-truth order (approved founder decisions > charter). This converts the partner-ecosystem expansion into a **phased roadmap** — it is *not* immediate V1 build scope. Bureau access, embedded credit, and card issuance remain **disabled until commercial agreements and compliance reviews exist**.

## Central principle

**AFLO owns the intelligence, readiness, workflow, and user relationship. Licensed partners own lending, card issuance, bureau data, custody, payments, and regulated execution.**

That is how AFLO feels unified without becoming five regulated companies. The market advantage is not that AFLO offers a card, a score, a course, news, or a credit-builder loan. The advantage is the orchestration loop:

> AFLO understands what the user needs next, explains why, prepares them, routes them to the appropriate provider, and measures whether the outcome improved their readiness.

## Build vs. orchestrate

| Build internally (AFLO owns) | Orchestrate through partners (integrate, never build) |
|---|---|
| Readiness scoring | Credit-builder loans |
| Lifecycle-stage logic | Secured cards |
| Credit intelligence | Credit monitoring |
| Goal and roadmap orchestration | Bureau reports and scores |
| Partner eligibility rules | Payment processing |
| Contextual education | Bank-account custody |
| User consent | Investment accounts |
| Audit trails | Loan origination |
| Referral tracking | Insurance policies |
| Outcome tracking | Claims administration |
| Personalized alerts | |
| Partner comparison | |
| Human-review controls | |

## Priority order (founder-approved)

### Build now (V1 / pilot)

1. Golden Key client lifecycle
2. Automated email workflows
3. Billing and Stripe test-mode payments
4. **Wealth Unlockers Academy**
5. Partner directory and referral tracking
6. **Credit-builder opportunity rules using mock providers**

### Build after the pilot

7. Real affiliate integrations
8. Bureau-data provider adapter
9. Credit monitoring and alerts
10. Opportunity and regulatory intelligence feed

### Build only after commercial and compliance validation

11. Embedded credit-builder applications
12. AFLO-branded secured card
13. Security-deposit or savings-linked products
14. Interchange-based revenue model

## Module specifications

### 1. Credit-Building Opportunity Engine (V1 item 6 — mock providers only)

Determines whether a user may benefit from: a credit-builder loan, a secured card, rent reporting, utility reporting, a lower-cost debt product, **or no new account at all**.

**Critical rule: AFLO never assumes another tradeline is beneficial.** The deterministic evaluation must first consider:

- Existing open accounts
- Recent inquiries
- Average account age
- Monthly affordability
- Payment-history weakness
- Utilization
- Upcoming mortgage or lending plans

Only then does AFLO present approved partner options **with disclosures**.

> ⚠️ **Commercial claims policy.** Do not hardcode AVA, CreditStrong, Self, or any affiliate compensation assumptions until actual commercial agreements are reviewed. Claimed acquisition payments ($20–$100) and ongoing revenue shares are **unverified commercial estimates**, not business-plan facts, and must never appear in code, docs, or projections as facts.

### 2. AFLO-branded secured card (phase 3 — NOT V1)

Issuer-processor platforms (e.g., Marqeta, Highnote) provide technology while sponsor banks provide the regulated services — a branded card is **not** a frontend integration. It requires decisions on: sponsor-bank approval, program management, KYC/CIP, OFAC screening, credit policy, servicing, disclosures, complaints, fraud, chargebacks, bureau reporting, security-deposit custody, and state/federal consumer-credit requirements.

**Required sequence:**

```text
Partner referrals → Embedded applications → Co-branded or white-label pilot → AFLO-branded secured card
```

> ⚠️ Do not use the "up to 2× interchange revenue" claim anywhere unless a program partner provides documented economics.

### 3. Bureau integration (adapter built in phase 2; live bureau access only when the phase-2/3 gate clears)

Provider-neutral by design — never architect around one bureau's proprietary response schema (Experian Partner Solutions, Array, or another approved provider must be swappable). "Credit monitoring and alerts" in the phase-2 list likewise means **building the integration and alerting surface** — monitoring data itself always comes from a licensed partner (see build-vs-orchestrate table):

```text
Bureau Provider → Credit Data Adapter → Normalized AFLO Credit Model
  → Deterministic Credit Rules → Credit Intelligence Agents → User Explanation + Staff Review
```

First implementation must include: explicit consumer authorization; identity verification; product and permissible-purpose controls; data-retention limits; refresh-frequency controls; dispute-routing boundaries; audit history; data-source labeling; score-model labeling; stale-data indicators.

> **Hard rule: AFLO never presents an internal readiness score as if it were a bureau credit score.**

### 4. Opportunity & Risk Intelligence Feed (phase 2, after core lifecycle works)

Monitors: federal agency updates, state/local programs, interest-rate changes, tax-rule updates, consumer-protection settlements, benefit changes, housing programs, employer-benefit deadlines, insurance-market changes.

Language boundary — the system may say: *"A public settlement may relate to an account in your profile. Review the official eligibility terms."* It may **not** say *"You are eligible to eliminate $3,000 of debt"* unless eligibility has been formally verified.

Required plumbing: trusted-source registry, publication date, effective date, jurisdiction, eligibility fields, source citation, rule version, user-profile matching, confidence level, **human review for legal or claims-related notices**, expiration and correction handling.

### 5. Wealth Unlockers Academy (V1 item 4 — build early)

Directly supports Golden Key Wealth's retention problem; no regulated integrations needed. **Event-driven assignment:**

```text
Utilization rises                        → assign utilization lesson
Document remains missing                 → assign document-readiness lesson
Client mixes business/personal expenses  → assign entity-separation lesson
Client approaches mortgage readiness     → assign pre-application lesson
```

Education must be: short, contextual, stage-specific, assigned from verified facts, measurable, connected to a real task, and reviewed by Golden Key Wealth.

> **Hard rule: course completion never "unlocks" regulated financial products.** It may unlock platform features, badges, coaching sessions, or discounts — financial-product eligibility comes only from partner criteria.

## Platform architecture additions (stubs now, implementation phased)

```text
packages/
  partner-marketplace/       # provider catalog, product categories, eligibility rules,
                             # compensation disclosures, referral links, application status,
                             # outcome tracking, conflict-of-interest disclosures
  credit-data/               # bureau-provider adapters, consumer consent, score-model
                             # metadata, report normalization, monitoring alerts, stale-data tracking
  opportunity-intelligence/  # trusted-source ingestion, jurisdiction + effective dates,
                             # eligibility-rule matching, personalized summaries, citations, review gates
  academy/                   # course/lesson library, stage-based + trigger-based assignment,
                             # completion tracking, knowledge checks, staff-authored content, engagement analytics
  embedded-finance/          # FUTURE-ONLY boundary: credit-builder, card-program, savings,
                             # investment, insurance partners — isolated from the readiness engine
```

`embedded-finance` must remain **isolated from the readiness engine** so commercial compensation can never change a user's readiness result.

## The Partner Neutrality Engine (required guardrail)

For **every** partner recommendation, AFLO stores:

- Why this option was shown
- All eligible alternatives
- Compensation AFLO may receive
- Whether a non-commercial option exists
- Estimated user cost
- Key risks
- Partner eligibility criteria
- Whether staff reviewed it

**A partner's commission must never affect the readiness calculation, and must never affect ranking without transparent labeling.**

## Disabled-until-validated gates

| Capability | Gate |
|---|---|
| Real affiliate integrations | Reviewed commercial agreements |
| Bureau data access | Provider contract + compliance review (FCRA permissible purpose, consent, retention) |
| Embedded credit-builder applications | Commercial + compliance validation |
| Card issuance (any branding depth) | Sponsor-bank program approval + full compliance review |
| Deposit/savings-linked products | Custody partner + compliance review |
| Interchange revenue modeling | Documented program economics from a partner |

Until a gate clears, the corresponding module stays a documented stub; mock providers only in code; no partner names or compensation figures hardcoded.
