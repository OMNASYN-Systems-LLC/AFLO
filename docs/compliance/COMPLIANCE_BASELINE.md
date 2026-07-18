# AFLO Compliance Baseline (V1)

**Product:** Golden Key Wealth, powered by AFLO
**Status:** Engineering posture for V1. **This document is not legal advice and asserts no legal conclusions.** It records the boundaries the software is designed around and the questions that require counsel.
**Sources:** `docs/product/PRODUCT_CHARTER.md` (authoritative) · `docs/business-plan/BUSINESS_PLAN_DIGEST.md` §13 (risk-isolation matrix) · `docs/product/V1_SCOPE.md` §4 (hard exclusions).

---

## 1. Positioning

AFLO V1 is **administrative and coaching workflow software**: it organizes leads and clients, tracks lifecycle stage via versioned deterministic rules, coordinates roadmaps and monthly actions, manages documents and appointments, and drafts staff-reviewed progress reports. It routes clients to licensed external professionals; it never performs their regulated work.

By design, AFLO is **not**:

- a **lender or credit broker** — no underwriting, approvals, pre-approvals, or brokering;
- a **credit repair organization** — zero credit-bureau interaction of any kind;
- a **tax preparer or practitioner** — no filings, no formal tax opinions, no final tax treatment;
- an **investment adviser or broker-dealer** — no securities selection, trading, or custody;
- a **money transmitter** — no initiating, executing, or holding funds;
- an **insurer or insurance producer** — no quoting, underwriting, or selling policies.

The business plan's risk-isolation matrix names the oversight regimes these boundaries are designed around — **IRS Circular 230** (informational output only; no filing signatures), **CROA** (no bureau dispute execution; metrics and readiness only), the **Investment Advisers Act / broker-dealer regimes** (no security-level recommendations), and **state money-transmitter licensing** (visibility only; zero balance reserves). These are cited as *designed-around engineering boundaries*, not as determinations of how any regime applies. Whether and when any regime attaches is a question for counsel (§5).

## 2. Hard Exclusions and Enforcing Controls

The charter's V1 exclusions apply **regardless of demand**. Each row names the control in the codebase that enforces it.

| Excluded in V1 (per charter) | Enforcing rule / control |
|---|---|
| Direct bureau pulls | No bureau integration exists; scores are manually entered, reports are client-uploaded with review states. |
| Automated credit disputes | Zero bureau interaction; `payment-history-agent` summarizes only and never contacts creditors; compliance-guard hard stop on dispute language. |
| Credit-score guarantees | `utilization-agent` never guarantees score impact; compliance-guard blocks unsupported claims in any drafted output. |
| Tax filing / final tax determinations | No e-file or tax-determination code paths; AI is propose-only and prohibited from determining tax treatment. |
| Securities selection / trading / brokerage custody | No brokerage integration; AI prohibited from selecting investments; partner routing to licensed professionals only. |
| Real-money transfers / autonomous capital movement | Micro-allocation is **simulation only** — virtual transactions, deterministic projections, no payment rails in the codebase. |
| Banking-as-a-Service | Not built; no deposit, card, or account-issuing integrations. |
| Loan underwriting / approval / reverse lender auctions | Partner-routing rules apply eligibility gates only and never approve loans or guarantee acceptance. |
| Insurance sales | Not built; referrals to licensed partners only. |
| Government benefit filing | Not built; submissions remain with the client or licensed representatives. |
| Smart contracts | Not built. |
| Production-grade AFLO Passport certification | Not built; only extensibility notes exist. |

Three controls do most of the enforcement work:

1. **Deterministic-only stage decisions.** Lifecycle stages (Recovery → Legacy) come from versioned rules in `packages/rules` with reason codes — never free-form LLM decisions.
2. **Propose-only AI.** Every agent output is a typed envelope (`packages/ai/src/envelope.ts`) of *proposed* actions with confidence, facts used, and rule versions. Only deterministic services or authorized humans update authoritative financial state.
3. **Compliance-guard hard stop.** The Compliance Guard Agent evaluates proposed outputs last; a non-empty `prohibitedActionsDetected` hard-stops the run.

## 3. Data Handling Commitments

From the charter's day-one security section:

- **Synthetic data only** during development — no real PII, credit reports, SSNs, bank records, or credentials in the repository; `.env.example` carries placeholders only.
- **Consent records** — client consent and revocation are recorded as first-class data.
- **Audit events** — every material state change, sensitive access, AI run, and approval is logged; critical audit records are immutable/append-only.
- **Encryption in transit** everywhere; encryption-at-rest requirements are a design obligation for the Neon/storage phase.
- **Authorization enforced server-side** with organization- and role-scoped queries; least privilege throughout; input validation at boundaries.
- **Retention** — assumptions must be documented; concrete schedules are **TBD** pending counsel (§5).
- **Uploads are sensitive** — typed categories, review states, short-lived signed URLs, audited access. **Malware scanning is a documented future requirement**, not yet implemented.
- **No raw sensitive documents to an LLM by default** — document summarization requires secure processing, and the first slice runs entirely on mock AI output with no AI API key.

## 4. Review Controls

- **Staff approval gates.** High-impact AI output (roadmaps, reports, communications) requires staff review or explicit client approval before it becomes active; approvals are audited (e.g., `roadmap.approved`).
- **Prohibited-action detection.** Every agent envelope carries `requires_human_review`, `review_status`, and `prohibited_actions_detected`; the compliance guard blocks unsafe language and unsupported recommendations before anything is shown or sent.
- **Rule change history.** Every deterministic rule in the `packages/rules` registry (`packages/rules/src/registry.ts`) carries a stable identifier, version, effective date, declared inputs/output, reason codes, and a change history; tests assert registry metadata against implementation constants. Rules that would depend on regulatory or tax thresholds must cite sources and effective dates before shipping — none do in V1.

## 5. Open Compliance Questions for Counsel

All items below are open. Nothing here presumes an answer.

| # | Question | Status |
|---|---|---|
| 1 | Do any **state coaching / credit-services disclosure or registration requirements** apply to Golden Key Wealth's coaching model or to AFLO as its software vendor (some state regimes are broader than federal CROA)? | TBD |
| 2 | **When does GLBA applicability begin** for AFLO/Golden Key, and what safeguards/notice obligations follow? (The business plan assumes Phases 2–3; timing needs confirmation.) | TBD |
| 3 | In which roadmap phase should **SOC 2 Type II** be pursued, and what interim attestations (if any) do early tenants or partners need? | TBD |
| 4 | What **retention and deletion schedules** apply to client documents (including uploaded credit reports), audit events, and AI run logs? | TBD |
| 5 | Does handling **client-uploaded credit reports** (storage, staff review, summarization) create any FCRA-adjacent obligations even with zero bureau interaction? | TBD |
| 6 | Is the planned **consent record model** (grants, revocation, audit) sufficient for the intended data uses, and what consent language is required at intake? | TBD |
| 7 | What **disclaimers** are required on roadmaps, quarterly reports, education content, and the round-up **simulator** so outputs are not read as financial, tax, or investment advice — and what marketing-claims review is needed (e.g., around score improvement)? | TBD |
| 8 | What **data processing agreements and subprocessor terms** are needed with Vercel, Neon, Railway, Resend, PostHog, Sentry, and any AI provider before real client data is introduced? | TBD |

Any change to the exclusions in §2, or any feature touching a regime in §1, requires updating this document and consulting counsel **before** implementation.
