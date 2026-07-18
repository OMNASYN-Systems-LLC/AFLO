# AFLO V1 Scope and Exclusions

**Product:** Golden Key Wealth, powered by AFLO
**Status:** Approved scope for V1 (Sprint 0 planning)
**Governing document:** `/CLAUDE.md` (execution brief). Where this document and the long-term business plan differ, the execution brief wins for V1.

---

## 1. What V1 Is

V1 is a **multi-tenant financial-readiness, client-retention, and workflow platform** for a financial-coaching business. It is staff-facing first: Golden Key Wealth staff use it to organize leads and clients, track lifecycle stage, assign roadmaps and monthly actions, review documents, and retain clients through structured engagement.

V1 is **not** the long-term AFLO vision (tax-cleanup wedge for 1099 solopreneurs, continuous verification middleware, Finance 5.0 control plane, or the Verified Passport). V1 must remain **architecturally compatible** with that vision — modular monolith, strict tenant isolation, deterministic rules separated from AI, full auditability — but it builds none of it.

### Non-negotiable constraints

| Constraint | Rule |
|---|---|
| Data | Synthetic data only during development. No real PII, credit reports, SSNs, bank records, or credentials in the repository. |
| Tenancy | Every tenant-owned table carries `organization_id`; queries are scoped by organization and role. |
| AI boundary | AI drafts, explains, summarizes, classifies tentatively, and asks clarifying questions. AI never alters financial facts, approves loans, selects investments, makes dispute decisions, determines tax treatment, or executes transfers. |
| Review | High-impact AI output requires staff review or explicit user approval. Every agent response carries the charter output contract: `agent_name`, `agent_version`, `organization_id`, `client_id`, `status`, `confidence`, `facts_used`, `missing_facts`, `rule_versions_used`, `reason_codes`, `proposed_actions`, `prohibited_actions_detected`, `requires_human_review`, `review_status`, `created_at`. |
| Stages | Lifecycle stages (Recovery → Stabilization → Credit Readiness → Capital Readiness → Acquisition → Maintenance → Growth → Legacy) are determined by versioned deterministic rules, never by free-form LLM decisions. |
| Audit | Every material state change writes an audit event. |

### Roles in V1

Platform Admin · Organization Owner · Golden Key Staff · Client · Partner Viewer *(later — role defined, UI deferred)*.

---

## 2. V1 Modules

Each module below lists a definition, the primary role(s) that use it, and what is explicitly out of scope for V1.

### 2.1 Authentication and Authorization

Sign-in, sessions, and role-based access control using Clerk or Auth.js, with an authorization matrix enforcing organization-level and user-level isolation. The first vertical slice ships a **staff sign-in shell** (visual only); real auth wiring follows in a subsequent slice.
**Primary roles:** All.
**Out for V1:** SSO/SAML for enterprise tenants, delegated admin hierarchies, client self-service password flows beyond the auth provider's defaults, mTLS gateways and field-level PII cryptography enclaves described in the long-term blueprint.

### 2.2 Organizations and Memberships

Multi-tenant organizations with member records, role assignments, and invitations. Golden Key Wealth is the first tenant; the model supports additional coaching organizations without code changes.
**Primary roles:** Platform Admin, Organization Owner.
**Out for V1:** Cross-organization data sharing, tenant self-signup and billing, white-label theming per tenant.

### 2.3 Lead and Client CRM

Pipeline of leads through conversion to clients, with pipeline stages, staff assignments, and basic search/filtering. This is the operational backbone for the staff dashboard and client list.
**Primary roles:** Golden Key Staff, Organization Owner.
**Out for V1:** Marketing automation, email campaign sequencing, lead scoring models, third-party CRM sync (HubSpot/Salesforce), telephony integration.

### 2.4 Client Onboarding and Intake

Structured intake forms capturing client context, consent, and initial goals, moving a lead into an active client with an onboarding-completed event.
**Primary roles:** Golden Key Staff, Client.
**Out for V1:** Identity verification (KYC), bank-account linking (Plaid or similar), automated document collection from third parties.

### 2.5 Financial Profile

A client's structured financial facts: income sources, debts and obligations, and basic balance-sheet inputs, entered manually by staff or the client. These facts feed deterministic calculators (utilization, debt ratios) and the readiness engine. Facts are mutated only through application services that validate permissions and write audit events — never by AI.
**Primary roles:** Golden Key Staff, Client.
**Out for V1:** Live account aggregation, transaction ingestion or CSV parsing, automated categorization, real-time balance sync.

### 2.6 Credit Profile (Manual Score Entry + Report Upload)

Manual entry of credit scores and key credit facts, plus upload of client-provided credit report documents into secure storage with a review state. The `credit-profile-agent` may summarize verified data and flag missing inputs; the `utilization-agent` and `payment-history-agent` run deterministic calculations and neutral summaries. (Full 12-agent roster and boundaries: `docs/architecture/AGENT_BOUNDARIES.md`.)
**Primary roles:** Golden Key Staff, Client.
**Out for V1:** Direct bureau pulls, tri-merge report ingestion, automated report parsing into structured tradelines, dispute generation or submission of any kind, score simulation promises.

### 2.7 Goals

Client financial goals (e.g., credit target, savings target, purchase readiness) with target dates and linkage to roadmaps and the round-up simulator.
**Primary roles:** Client, Golden Key Staff.
**Out for V1:** Goal-based investing, automated funding of goals, ticker-level or product-level recommendations.

### 2.8 Readiness-Stage Engine

Deterministic, versioned rules that place each client in one of the eight lifecycle stages and return reason codes. The `readiness-stage-agent` evaluates versioned rules only; rule versions are recorded with every assessment so results are reproducible and auditable.
**Primary roles:** System (deterministic), surfaced to Golden Key Staff and Client.
**Out for V1:** LLM-decided stage placement, per-tenant custom rule authoring UI (rules are code/config-versioned), predictive stage forecasting.

### 2.9 Roadmaps, Milestones, and Tasks

A per-client roadmap composed of milestones and tasks derived from approved facts and deterministic outputs. The `roadmap-agent` drafts; staff review and approve before a roadmap becomes active (`roadmap.approved` is audited).
**Primary roles:** Golden Key Staff (author/approve), Client (view/complete).
**Out for V1:** Auto-approved AI roadmaps, roadmap marketplace/templates shared across tenants, dependency-graph project management features.

### 2.10 Monthly Action Plans

A monthly slice of the roadmap: the small set of concrete actions a client should complete this month, with completion tracking feeding engagement analytics.
**Primary roles:** Client, Golden Key Staff.
**Out for V1:** Automated plan regeneration without staff review, payment-linked action verification.

### 2.11 Contextual Education

Curated educational content assigned in context (stage, goal, or task). The `education-agent` selects relevant content from an approved library; it does not author financial advice.
**Primary roles:** Client, Golden Key Staff.
**Out for V1:** AI-generated educational content published without review, external content licensing, LMS features (quizzes, certifications).

### 2.12 Documents and Review States

Client document upload to Vercel Blob/S3-compatible storage with typed categories, review states (e.g., pending, reviewed, needs-attention), signed short-lived URLs, and audited access.
**Primary roles:** Client (upload), Golden Key Staff (review).
**Out for V1:** OCR/automated extraction, e-signature, document generation for institutional submission, receipt-to-transaction matching (long-term wedge feature).

### 2.13 Appointments and Reminders

Scheduling of client appointments with staff, plus reminder notifications sent via Resend from the Railway worker.
**Primary roles:** Golden Key Staff, Client.
**Out for V1:** Two-way external calendar sync, video-conferencing integration, self-serve public booking pages, SMS.

### 2.14 Quarterly Progress Reports

Quarterly summaries of a client's stage movement, completed actions, and goal progress. The `report-agent` drafts; staff review before delivery. Generation runs on the Railway worker; the first slice ships a **report preview** with synthetic data.
**Primary roles:** Golden Key Staff (review/send), Client (receive).
**Out for V1:** Institution-facing verified reports or passports, automated delivery without review, custom report builders.

### 2.15 Partner Directory and Referrals

A directory of vetted external partners (lenders, CPAs, attorneys, etc.) with capabilities, referral rules, and referral tracking. AFLO routes context to licensed professionals; it never performs their regulated work.
**Primary roles:** Golden Key Staff; Partner Viewer later.
**Out for V1:** Partner-facing portal, automated data-payload delivery to partners, referral-fee accounting, API integrations into partner systems.

### 2.16 Admin Notes and Communication History

Staff notes on leads/clients and a chronological log of communications (emails sent, calls logged, messages), forming the client's operational history.
**Primary roles:** Golden Key Staff, Organization Owner.
**Out for V1:** Email inbox sync, call recording/transcription, AI sentiment analysis of communications.

### 2.17 Engagement and Retention Analytics

Engagement events, inactivity detection, and risk flags. The `engagement-agent` detects inactivity and recommends follow-up; staff decide whether to act. PostHog captures product analytics.
**Primary roles:** Golden Key Staff, Organization Owner.
**Out for V1:** Churn-prediction ML models, automated outreach without staff approval, cross-tenant benchmarking.

### 2.18 Virtual Round-Up / Micro-Allocation Simulator

A **simulation-only** tool showing what round-ups or micro-allocations against a client's stated spending pattern would accumulate toward a goal. All transactions are virtual; projected outcomes are deterministic calculations. Inspired only by general UX patterns of round-up products — no copied screens, wording, or trade dress.
**Primary roles:** Client, Golden Key Staff.
**Out for V1:** Real money movement of any kind, linked debit/credit cards, brokerage or savings account integration, actual round-up execution.

### 2.19 Audit and Consent Records

Immutable audit events for every material state change (sensitive reads, writes, exports, sharing), rule-version records, AI run logs, approvals, and client consent/data-sharing grants.
**Primary roles:** Platform Admin, Organization Owner; written by the system.
**Out for V1:** External audit-log export integrations (SIEM), cryptographically signed audit chains (long-term passport feature), consent-driven data delivery to third parties.

---

## 3. First Vertical Slice: Synthetic-Data Visual Prototype

The first deliverable is a working visual prototype on **synthetic data**, using mock repositories behind interfaces that Neon-backed implementations will later replace. No real auth wiring, no external integrations, no real financial data.

The slice must support:

1. **Staff sign-in shell** — visual entry point; auth provider wiring deferred.
2. **Golden Key dashboard** — org-level view of pipeline, engagement risk, and upcoming work.
3. **Lead/client list** — searchable, filterable, navigable.
4. **Client profile (detail view)** showing:
   - Current **readiness stage** (with reason codes)
   - Current **goal**
   - **Roadmap milestones** and progress
   - **Monthly actions**
   - **Document status** (review states)
   - **Next appointment**
   - **Engagement status** (risk flag)
   - **Quarterly report preview**

Visual direction: obsidian/charcoal, warm ivory, muted gold, deep emerald, slate gray; spacious layout, strong typography, minimal charts; clear stage and next-action display. No generic AI gradients, robots, crypto imagery, or excessive glassmorphism.

### Definition of Done (first visual)

- [ ] The app runs locally.
- [ ] The app builds successfully.
- [ ] The dashboard renders responsive synthetic client data.
- [ ] Navigation reaches the client list and client detail.
- [ ] The client detail clearly shows stage, next action, roadmap, progress, and document status.
- [ ] No real financial data is used.
- [ ] No regulated action is implied or executed.
- [ ] The code is organized for later Neon integration (repository interfaces defined).

---

## 4. Hard Exclusions

These are excluded from V1 **regardless of demand**. Each maps to the risk-isolation posture in the business plan: AFLO operates as an administrative data processor and preparation layer, never as a licensed financial actor. Regulated and irreversible actions are routed to licensed external partners.

| Excluded capability | What we will not build in V1 | Regulatory rationale (risk-isolation matrix) |
|---|---|---|
| **Credit bureau pulls** | No direct bureau integrations or live credit data reporting; scores are manually entered and reports are client-uploaded. | FCRA obligations attach when interfacing with consumer reporting agencies; AFLO defers FCRA alignment to a later phase and holds zero bureau interactions in V1. |
| **Automated credit disputes** | No generating, filing, or advising on bureau balance challenges or negative-item disputes. | CROA: executing bureau disputes makes a company a credit repair organization. AFLO's safeguard is zero bureau interaction — it works strictly on metrics and readiness. |
| **Tax filing / tax opinions** | No electronic filing, no formal tax treatment determinations, no signed tax positions. | IRS Circular 230: formal tax opinion delivery and filing signatures trigger practitioner obligations. AFLO restricts output to informational models; filing belongs to licensed preparers/CPAs. |
| **Investment selection** | No ticker-level or product-level investment advice, portfolio management, or securities execution. | Investment Advisers Act / broker-dealer regimes: security-level recommendations trigger RIA/BD registration. AFLO restricts data to macro allocations and risk trends. |
| **Money movement / transfers** | No initiating, executing, or holding funds — including real round-ups (simulator is virtual only). | State money transmitter licensing (MTL) attaches to direct initiation of capital transfers. AFLO maintains data visibility and holds zero balance reserves. |
| **Loan underwriting / brokering** | No credit decisions, approvals, pre-approvals, or brokering on AFLO's or the tenant's behalf. | AFLO is not a lender or credit broker: it does not underwrite risk on its balance sheet. Capital decisions remain with licensed lenders reached via the partner directory. |
| **Insurance sales** | No quoting, underwriting, or selling risk-mitigation policies. | Insurance producer licensing is state-regulated; AFLO is not an insurance broker and refers to licensed partners. |
| **Government benefit submissions** | No filing or submitting applications to government benefit, housing, or support programs on a client's behalf. | Agency-specific authorized-representative rules apply; AFLO remains an un-certifying data processor and leaves submissions to the client or licensed representatives. |

Additional V1 exclusions: no banking-as-a-service (carried from the README), and no persistent bank-connection maintenance (from the business plan MVP's "exclude entirely" list — see `docs/business-plan/BUSINESS_PLAN_DIGEST.md`).

---

## 5. Deferred (Long-Term Roadmap, Not V1)

These are compatible with the V1 architecture but explicitly deferred: transaction CSV ingestion and business/personal triage, receipt-to-ledger matching, Schedule C tax packs, continuous underwriting simulations, the Verified Passport, B2B CPA/lender portals, mobile shells, and any autonomous capital orchestration. Nothing in V1 may foreclose these; nothing in V1 builds them.
