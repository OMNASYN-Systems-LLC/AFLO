# AFLO Product Charter

> **Status:** Authoritative. Supplied by the founder 2026-07-17. This charter supersedes older strategy drafts wherever they conflict. Repository documents must be reconciled to it; deltas are tracked in the PR that introduced this file.

## Product identity

AFLO (Autonomous Financial Lifecycle Orchestrator) is being developed as:

1. A financial-readiness, client-retention, and workflow platform for Golden Key Wealth.
2. A future financial verification and interoperability layer connecting users, professionals, and institutions.

The first implementation is presented as **"Golden Key Wealth, powered by AFLO."**

Near-term: organize leads and clients, create personalized readiness roadmaps, coordinate monthly actions, deliver contextual financial education, monitor engagement, produce quarterly progress reports, and connect clients to appropriate professionals.

Long-term: convert a user's evolving financial life into trusted, permissioned, institution-ready intelligence.

## Direction-resolution order

1. User safety and trust
2. Data security and consent
3. Golden Key Wealth's real workflow
4. Approved V1 scope
5. Pilot validation
6. Long-term architecture
7. Experimental features

## Business-plan reconciliation

The broader business plan's expansion opportunities (financial cleanup, transaction normalization, tax readiness, CPA-ready exports, lender-ready files, solopreneurs, 1099 workers, W2-to-business users) are **not discarded**. AFLO is a reusable multi-tenant platform with:

- Golden Key Wealth Credit Recovery and Financial Readiness as the first implementation.
- Financial Cleanup and Tax Readiness as a later product module.
- AFLO Verified Passport and institutional APIs as long-term infrastructure.

The V1 user experience serves Golden Key Wealth. The domain model must not block later solopreneur, CPA, lender, employer, nonprofit, or institutional use cases.

## Primary mission

Build the first secure, functional, responsive AFLO visual and technical foundation answering: *"Can Golden Key Wealth use AFLO to organize clients, provide a clear financial roadmap, sustain engagement, reduce administrative work, and demonstrate measurable progress?"* Do not attempt all of Finance 5.0 in the first release.

## Delivery sequence

Small vertical slices, in order: (1) repository/architecture audit, (2) written implementation plan, (3) ADRs, (4) monorepo scaffolding, (5) shared domain model, (6) synthetic Golden Key data, (7) frontend shell, (8) staff dashboard, (9) lead/client pipeline, (10) client detail and readiness journey, (11) deterministic rules, (12) credit intelligence interfaces, (13) roadmap and task workflow, (14) document and report foundations, (15) tests and CI, (16) deployment documentation, (17) draft pull request. No broad coding before the implementation plan is documented.

## Technology stack

GitHub · pnpm workspaces · Next.js App Router · TypeScript strict · Tailwind CSS · Vercel (web) · Neon PostgreSQL · Railway (workers/jobs/queues) · **Drizzle ORM** unless a written ADR shows a stronger reason for Prisma · Clerk or Auth.js after documenting security and multi-tenant implications · Vercel Blob or S3-compatible storage · Resend · PostHog · Sentry · Vitest · Playwright · a provider-neutral internal AI interface supporting Claude and OpenAI. No paid integrations or production credentials required for the first visual.

## Monorepo structure

```
apps/        web/  worker/
packages/    database/ auth/ ui/ rules/ ai/ reports/ notifications/ analytics/ shared/ config/
docs/        business-plan/ product/ architecture/ compliance/ research/ design/ adr/ deployment/
```

Web on Vercel, workers on Railway; shared domain logic lives in packages, never duplicated between apps.

## Architecture model

Modular monolith; no premature microservices. Separated modules: identity/access, organizations/memberships, leads/clients, intake/financial profiles, credit profiles, goals/lifecycle stages, roadmaps/milestones, monthly tasks, educational content, documents, appointments, communications, engagement/retention, quarterly reports, partners/referrals, adaptive micro-allocation simulation, deterministic rules, AI orchestration, consent, audit history, background jobs, notifications. Web and worker deploy separately sharing database, types, rules, and domain services.

## Multi-tenancy

Golden Key Wealth is the first organization, not the only one. Every tenant-owned record is organization-scoped. Roles: **Platform Admin, Organization Owner, Organization Admin, Advisor/Staff, Client, Partner Viewer (later)**. The authorization matrix precedes protected workflows. Tenant-aware queries plus PostgreSQL row-level security where practical (or an equivalently strict documented strategy).

## V1 user types

- **Golden Key Staff**: manages leads/clients, reviews intake, creates/approves roadmaps, assigns tasks, reviews documents, records communications, tracks engagement, generates quarterly reports, routes clients to partners.
- **Client**: completes intake, selects goals, uploads documents, reviews roadmap, completes monthly actions, views education, tracks progress, reviews reports, manages consent.
- **Platform Admin**: manages platform configuration; does not casually access client financial data; all sensitive access justified and audited.

## Financial lifecycle

Versioned domain configuration: Recovery → Stabilization → Credit Readiness → Capital Readiness → Acquisition → Maintenance → Growth → Legacy. The frontend always makes clear: current stage, primary goal, next action, current blockers, recent progress, and what stage comes next. No unexplained scores or black-box classifications.

## First frontend visual

Required screens: (1) Golden Key Staff Dashboard, (2) Lead and Client Pipeline, (3) Client Directory, (4) Client Detail, (5) Client Roadmap, (6) Monthly Action Plan, (7) Documents, (8) Appointments, (9) Quarterly Report Preview.

Dashboard includes: active leads, active clients, clients requiring attention, reviews due, upcoming appointments, engagement-risk indicators, stage distribution, recent client progress, next staff actions.

Client detail includes: identity summary, primary financial goal, current lifecycle stage, stage explanation, next recommended action, credit profile summary, income/debt/obligation summary, roadmap progress, monthly tasks, missing documents, engagement status, next appointment, partner referral status, quarterly report preview.

Synthetic records only.

## V1 product modules

Foundational representations for: authentication, organization, membership, lead, client, client goal, financial profile, credit profile, income source, debt, monthly obligation, readiness assessment, roadmap, roadmap milestone, client task, education module, education assignment, document, document review, appointment, communication, progress report, partner, partner referral, consent record, audit event, rule set, rule version, AI run, outbox event, micro-allocation simulation.

## Database requirements

Neon PostgreSQL; UUID primary keys; `organization_id` on all tenant-owned records; `created_at`/`updated_at`/`created_by` where relevant; controlled enums for status fields; useful indexes; auditable transitions; soft deletion only where justified; immutable/append-only critical audit records; clear foreign keys; no production PII in seed data. Never store passwords directly; never invent custom authentication cryptography.

## Credit Intelligence Engine

A bounded engine — not an unrestricted autonomous financial adviser. One orchestrator with **twelve** specialized logical agents, beginning as typed internal modules, deterministic tools, and mock AI responses (never independent microservices):

| Agent | Responsibility boundary |
|---|---|
| Intake Completeness Agent | Identifies missing fields/documents; produces clarification requests |
| Credit Profile Agent | Summarizes user-provided credit information; flags facts requiring staff verification |
| Utilization Agent | Deterministic utilization calculations and thresholds; never guarantees score impact |
| Payment History Agent | Organizes user-provided payment history; flags inconsistencies; never contacts creditors |
| Debt and Obligation Agent | Summarizes balances and monthly obligations; supports readiness calculations |
| Readiness Stage Agent | Applies versioned deterministic stage rules; returns reason codes; cannot silently override human-approved exceptions |
| Roadmap Agent | Drafts roadmaps from verified facts and approved templates; no legal or regulated decisions |
| Education Agent | Selects education relevant to current stage and task |
| Engagement Agent | Identifies inactivity, incomplete tasks, missed reviews, missing documents |
| Report Agent | Drafts quarterly progress summaries from verified data |
| Partner Routing Agent | Applies approved eligibility/routing rules; never approves loans or guarantees acceptance |
| Compliance Guard Agent | Evaluates proposed outputs for prohibited claims/actions; blocks unsafe language or unsupported recommendations |

### Agent output contract

Every agent output includes: `agent_name`, `agent_version`, `organization_id`, `client_id`, `status`, `confidence`, `facts_used`, `missing_facts`, `rule_versions_used`, `reason_codes`, `proposed_actions`, `prohibited_actions_detected`, `requires_human_review`, `review_status`, `created_at`.

AI agents may propose. Only deterministic services or authorized humans update authoritative financial states.

## Deterministic rules engine

Versioned rules for: lifecycle-stage assignment, credit-utilization calculations, intake completeness, document completeness, roadmap eligibility, milestone dependencies, task completion, progress percentages, engagement-risk thresholds, report-period calculations, partner-routing gates, virtual micro-allocation simulation.

Every rule has: stable identifier, version, effective date, description, inputs, output, reason codes, unit tests, change history. Unstable regulatory/tax thresholds require source documentation, effective dates, and review controls before hardcoding.

## AI context layer

AI **may**: draft roadmap language, explain concepts plainly, ask clarification questions, draft progress summaries, suggest education, draft communications for review, summarize uploaded documents after secure processing.

AI **may not independently**: dispute credit information, guarantee credit improvements, determine final tax treatment, select investments, approve lending, execute payments, transfer or custody money, submit government applications, sell insurance, modify verified source facts.

AI outputs are schema-validated and logged in `ai_runs`. The first frontend works with mock AI results and no AI API key.

## Adaptive micro-allocation

V1 is **simulation only**: nearest-dollar round-ups, fixed contributions, estimated monthly accumulation, selected financial goal, projected roadmap impact. No money movement, no brokerage linking, no representing simulated funds as deposited or invested.

## Background worker

Railway worker (future) for reminder scheduling, appointment reminders, engagement checks, quarterly report generation, notification delivery, document processing, AI tasks, retry handling, dead-letter review. PostgreSQL outbox pattern initially; idempotent jobs; no Kafka or distributed workflow engines unless proven necessary.

## Golden Key workflow discovery

Do **not** invent Natalia's operating workflow. Maintain a structured discovery document (see `docs/research/GOLDEN_KEY_WORKFLOW_DISCOVERY.md`) covering lead sources, marketing systems, CRM tools, intake forms, service packages, client stages, follow-up process, communication channels, credit-report workflows, educational content, reports, documents, partners, drop-off points, retention problems, and repetitive administrative work. Unknowns are marked TBD with documented assumptions, kept out of deep architecture, with configuration points where possible.

## Competitor research boundary

Public product patterns from Acorns, Credit Karma, My Credit Score Now, Monarch, YNAB, coaching CRMs, and client progress platforms may inform general patterns only (onboarding, goal selection, progress visibility, round-up simulation, education prompts, alerts, retention workflows). Never copy source code, private APIs, brand assets, proprietary text, page layouts, trade dress, screenshots, restricted workflows, or confidential methods.

## Design system

Communicate quiet authority, safety, dignity, intelligence, progress, service. Obsidian/charcoal, warm ivory, muted gold, deep emerald, slate gray; strong typography; spacious layouts; restrained status indicators; accessible contrast; clear hierarchy. Avoid generic AI gradients, purple/blue neon, robots, crypto imagery, excessive glassmorphism, dense dashboards, shame-based language, and unexplained good/bad labels. Plain language. **Next action always more prominent than analytics.** (See `docs/design/DESIGN_SYSTEM.md`.)

## Security and privacy (day one)

Synthetic data only; never commit credentials, tokens, credit reports, SSNs, bank data, or client PII; `.env.example` with placeholders; validate inputs; enforce authorization server-side; log sensitive access; encrypt in transit; design encryption-at-rest requirements; least privilege; document retention assumptions; record consent and revocation; treat uploads as sensitive; design malware scanning as a future requirement; do not send raw sensitive documents to an LLM by default.

## V1 exclusions

No direct bureau pulls, automated disputes, credit-score guarantees, tax filing, final tax determinations, securities selection, trading, brokerage custody, real-money transfers, Banking-as-a-Service, insurance sales, loan underwriting/approval, reverse lender auctions, government benefit filing, smart contracts, autonomous capital movement, or production-grade AFLO Passport certification. Interfaces/architecture notes for later features only where needed for extensibility.

## Sprint plan

- **Sprint 0**: audit, documentation, implementation plan, ADRs, multi-tenant architecture, authorization matrix, initial schema, workflow discovery questions, monorepo scaffold, lint/typecheck/test/build/CI.
- **Sprint 1**: application shell, synthetic Golden Key organization, dashboard, pipeline, client directory, client detail with stage/goal/next action/milestones/tasks/documents/engagement/appointment/report preview.
- **Sprint 2**: deterministic readiness examples, utilization calculations, task dependencies, progress calculations, micro-allocation simulation, typed agent contracts, mock AI outputs, tests.
- **Sprint 3**: Neon schema and migrations, authentication, organization-scoped authorization, document metadata, consent and audit events, worker/outbox foundation, deployment documentation.

## Delivery process

Feature branches only (never main); small descriptive commits; documentation synchronized with code; run lint, typecheck, unit tests, critical Playwright tests, production build; review dependency vulnerabilities; open a draft PR; **never merge without explicit approval**. "Continuous development" = build a slice → test → document → open/update draft PR → review → merge only after approval → next slice.

## Acceptance criteria for the first visual

Repository installs; app runs locally; production build succeeds; responsive frontend; Golden Key branding; synthetic leads/clients render; dashboard, directory, and detail navigation work; current stage, primary goal, and next action are obvious; roadmap milestones, monthly tasks, document status, engagement status, next appointment, and quarterly report preview are visible; deterministic rule examples have tests; agent boundaries are represented in code; no regulated activity executed; no real PII; Vercel/Railway/Neon requirements documented; a draft PR is ready for founder review.
