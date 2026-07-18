# Founder Directive — 2026-07-18 (Authoritative)

Status: **Accepted founder decision** (source-of-truth rank #1). This directive extends and, where they conflict, supersedes prior briefs. It does not replace the deterministic-core, tenant-isolation, AI-boundary, or compliance guarantees already in force — it strengthens them. This file is the durable capture; `CLAUDE.md` and `BUILD_STATUS.md` are reconciled to it.

## Brand

- Display brand **ΛFLO**; technical/plain-text **AFLO**. Usage table and rules in `docs/design/BRAND_SYSTEM.md §0`. Do not rename `@aflo/*` or any technical identifier.
- Academy: **ΛFLO Wealth Academy** (nav label **Wealth Academy**); content = *Wealth Unlockers curriculum*.

## Navigation contracts

- **Client:** Home · Passport · Plan · Wealth Academy · Messages.
- **Staff:** Dashboard · Leads · Clients · Tasks · Reports · Partners · Billing · Settings.

## Readiness presentation

- No score resembling a bureau score unless documented, versioned, tested, explainable, and clearly distinguished. Any future numeric score is labeled **ΛFLO Readiness Index — not a consumer credit score and not a lending decision**. Never merge bureau scores into a fabricated unified score. For V1, lead with stage, status, completed requirements, blockers, next milestone, next action.

## New commercial-grade requirements (buildable, credential-free unless noted)

- **Scenario simulator** — deterministic: individual/aggregate utilization, balance reductions, monthly obligations, front/back-end DTI *indicators*, cash-flow effect, reserve coverage, payoff sequencing. Language: "estimated arithmetic effect", "potential readiness effect", "actual bureau-score impact may vary", "not a lending decision". Never "this will increase your score by X" / "guarantees approval".
- **Adaptive intake engine** — profile types (student, unemployed, W-2, 1099, mixed-income, multi-entity owner) drive *questions/documents/education/review only*, never permanent labels; save/resume, section tracking, consent, staff review, events, audit, org-scoped.
- **Behavioral Support Engine** — opt-in (unchecked by default, plain-language, revocable, versioned, timestamped, audited, separate from service terms). Pseudonymized, purpose-limited behavioral metadata. May influence reminder timing / pacing / education / support / friction / re-engagement / UI personalization **only**. Must never affect readiness, eligibility, underwriting, ranking, pricing, access, or adverse-action. No clinical/psychological labels; use neutral terms (engagement preference, reminder sensitivity, support cadence, action-friction indicator). No raw behavioral telemetry to external LLMs; no partner export; no cross-tenant analysis.
- **Notification preferences** — user-controlled router; channels in-app/email/SMS (push later); explicit, granular, revocable, audited, org- & user-scoped, **enforced before send**. No sensitive data over SMS/email; use secure portal links.
- **Communication providers** — adapters; Resend (email) / Twilio (SMS) first; idempotency, delivery logging, bounce/complaint/unsubscribe, retry, dead-letter, consent enforcement, template versioning, test/preview mode, kill switch.
- **Wealth Academy** — `packages/academy` domain logic; courses/modules/lessons/ebooks/workshops/knowledge-checks; event-driven triggers; assignment provenance (source event, rule version, reason code, content version, timestamps, knowledge-check, staff review). Completion never determines regulated-product eligibility. No proprietary video streaming; signed external playback.
- **Tax/CPA prep** — candidate-classification workflow only (possible category → clarification → professional review → export); never "guaranteed deduction"/"audit-proof"/"IRS-approved". Exports: CSV, JSON, manifests, unresolved-questions.
- **Professional portal** — future role-based (CPA/accountant/bookkeeper/institutional reviewer) gated on org permission + client consent + recipient scope + expiration + audit + least privilege.
- **Signed handoff packages** — canonical JSON, SHA-256 digest, **asymmetric** digital signatures (a hash alone is not a signature), key IDs, rotation, verification, expiration, revocation, recipient/consent scope, audit, versioned schemas. Do not call output "audit-proof"/"legally verified"/"zero-knowledge" unless truly reviewed.
- **Append-only, tamper-evident audit history** — do not claim absolute immutability unless storage enforces it.
- **Field-level encryption** — classify first; AES-256-GCM envelope encryption via a centralized service for selected fields (government/tax IDs, selected bank details, sensitive identity/professional data). Passwords & payment credentials are never stored. Not "zero PII" — "pseudonymized and purpose-limited".
- **Credit-data** — provider-neutral interfaces only (`packages/credit-data`); **no production bureau activation**. Eval order: Experian Partner Solutions → Array → other approved. No scraping, no unauthorized pulls, Readiness Index never presented as a bureau score.
- **Partner orchestration** — MVP tracked external referrals + Partner Neutrality records (why shown, all alternatives, ΛFLO compensation, non-commercial option, user cost, risks, ranking reason). No embedded registration until signed agreement + approval. Compensation never alters readiness or ranking.
- **Opportunity intelligence** — curated trusted-source registry first (official source/URL/jurisdiction/dates/eligibility/review status/citation/confidence/rule version). No unrestricted crawlers; no final legal/benefit determinations. Safe language only.
- **Synchronization** — every integration: adapter, account id, cursor/watermark, last sync, status, error code, retry, idempotency, source id/version/timestamp, mapping, conflict strategy, reconciliation, kill switch. Webhooks never assumed complete/ordered; scheduled reconciliation + duplicate/out-of-order tolerance + drift detection.
- **Security/operability** — structured logs w/ correlation/request/org/workflow/event/agent-run/job ids; health & readiness endpoints; worker heartbeat; deployment verification; smoke tests; rollback + incident + secret-rotation + DB-recovery runbooks; DLQ/webhook replay; maintenance mode; feature flags; kill switches. Every integration has a kill switch.

## Agent architecture

Hierarchical under the **Financial Lifecycle Orchestrator** with departments (Credit Intelligence, Roadmap & Behavior, Education, Document Intelligence, Partner Orchestration, Communications, Billing, Compliance & Safety, Operations). Do not create agents to inflate the count, and **do not build agents before the underlying workflows and verified data exist**. Expanded agent output contract adds: `run_id`, `workflow_id`, `tools_used`, `warnings`, `error_code`, `correlation_id`, `causation_id`, `started_at`/`completed_at` to the existing envelope. Agents may draft/explain/compare/propose; never modify verified facts, guarantee scores, dispute, approve loans, execute transfers, charge independently, override deterministic gates, hide compensation, infer clinical conditions, or alter eligibility from behavioral metadata.

## Implementation order (from current main)

1. Lead→client conversion ✅ · 2. Structured intake ✅ · 3. Neon/Drizzle persistence (schema ✅; connection gated on `DATABASE_URL`) · 4. Authorization, RLS, audit, tenant isolation (audit + tenant isolation ✅; RLS DDL as defense-in-depth) · 5. Readiness rules ✅ · 6. Roadmap & monthly actions ✅ · 7. Clerk auth (boundary ✅; activation gated on keys) · 8. Outbox worker (gated on shared DB) · 9. **Notification preferences** · 10. Resend email adapter (gated on keys; test mode buildable) · 11. Twilio SMS adapter test mode (gated on keys) · 12. **ΛFLO Wealth Academy** · 13. **Reports & signed verification packages** (reports ✅; signing buildable) · 14. Stripe test-mode billing (gated on keys) · 15. **Tracked partner referrals** · 16. **Partner neutrality records** · 17. **Provider-neutral credit-data interfaces** · 18. **Behavioral Support Engine (opt-in)** · 19. **Opportunity-intelligence trusted-source registry** · 20. Pilot · 21. Evaluate bureau/embedded-finance providers.

Blocked workstreams pause; safe work continues elsewhere. Do not let external rails replace completion of the internal client lifecycle.
