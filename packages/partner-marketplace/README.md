# @aflo/partner-marketplace

Tracked partner referrals and the **Partner Neutrality Engine** (`partner.v1.0.0`).

## What lives here

- **`catalog`** — `PartnerCategory` and the `Partner` directory type. No real partner names or compensation figures are hardcoded here; dev providers are synthetic (ADR-0007).
- **`referral`** — the referral lifecycle allow-list: `suggested → shared_with_client → client_engaged → outcome_recorded`, with `declined` reachable from any non-terminal state. `outcome_recorded` and `declined` are terminal. Plus the staff-observed `ReferralOutcome` set — observations, never approvals.
- **`neutrality`** — the eight-field `NeutralityRecord` required on every recommendation (ADR-0007 §3), `validateNeutralityRecord` (fail-closed), and `orderPartnerOptions` (non-commercial first, then name — **never** by compensation).

## Boundaries (charter / ADR-0007)

- AFLO **orchestrates and routes** to licensed partners; it never becomes the lender, card issuer, custodian, or bureau. It never approves a loan or guarantees acceptance.
- A partner's compensation **never** affects the readiness calculation and **never** affects ranking without transparent labeling.
- A referral cannot be created without a **complete** neutrality record — the store fails closed.
- Non-commercial options are a **first-class** outcome and are surfaced first.
- Real partner names and compensation terms enter only behind reviewed commercial agreements; until then, providers are synthetic.
