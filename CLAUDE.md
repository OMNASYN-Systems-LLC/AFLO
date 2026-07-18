# Claude Execution Brief — AFLO

You are the principal software architect and implementation partner for AFLO, the Autonomous Financial Lifecycle Orchestrator.

> **Source-of-truth order.** This brief is authoritative below `docs/product/PRODUCT_CHARTER.md`. Resolve conflicts using: (1) approved founder decisions — including `docs/product/FOUNDER_DIRECTIVE_2026-07-18.md`, (2) the Product Charter, (3) this file, (4) accepted ADRs, (5) architecture docs, (6) V1 scope, (7) partner-orchestration roadmap, (8) business-plan digest, (9) historical research. When this file and a higher source disagree, the higher source wins and this file is updated to match — never leave two active architectures.

> **Brand (founder decision 2026-07-18).** Display brand is **ΛFLO** (Greek capital lambda + FLO); technical/plain-text is **AFLO**. Use ΛFLO in product UI, marketing, reports, Academy, and client/partner-facing materials; use AFLO in repo/package names (`@aflo/*` — never renamed), source, env vars, database identifiers, URLs, APIs, logs, and accessibility fallbacks. Academy: **ΛFLO Wealth Academy** (nav label **Wealth Academy**). Full brand rules: `docs/design/BRAND_SYSTEM.md §0`; full directive: `docs/product/FOUNDER_DIRECTIVE_2026-07-18.md`.

## Product Mission

Build **Golden Key Wealth, powered by ΛFLO** (technical: AFLO) as the first production implementation. The V1 is a multi-tenant financial-readiness, credit-recovery, client-retention, workflow, education, reporting, referral, billing, and communication platform. Long term, AFLO becomes a financial verification and interoperability layer for consumers, professionals, employers, lenders, CPAs, community organizations, and institutions — but V1 must solve Golden Key Wealth's actual operating problems first.

## Immediate Objective

Create a secure, testable, production-oriented foundation that reaches a basic visual frontend quickly while preserving the architecture required for future credit intelligence, financial readiness, reporting, partner routing, and autonomous workflow support.

Do not attempt to build every long-term feature at once. Deliver in small, reviewable vertical slices.

## Required Stack

- pnpm-workspaces monorepo
- Next.js App Router + TypeScript (strict) web application deployed to Vercel (`apps/web`)
- Railway worker service for scheduled jobs and long-running processing (`apps/worker`)
- Neon PostgreSQL (branches: `main` prod, `preview`, `dev`)
- Drizzle ORM (ADR-0005) unless a later accepted ADR changes it
- Tailwind CSS
- Clerk via `packages/auth` (Auth.js fallback per ADR-0006, founder-gated)
- Stripe for invoices, subscriptions, and automatic payments (regulated execution stays with Stripe)
- Resend for email via `packages/notifications`
- Vercel Blob or private S3-compatible document storage (signed URLs only)
- PostHog
- Sentry
- Provider-neutral AI integration supporting `mock`, Claude, and OpenAI via `packages/ai`

**Workspace packages:** `database`, `auth`, `ui`, `rules`, `ai`, `reports`, `notifications`, `analytics`, `billing`, `integrations`, `shared`, `config`, plus the gated partner-orchestration packages `academy`, `partner-marketplace`, `credit-data`, `opportunity-intelligence`, `embedded-finance` (documented stubs until their phases clear — `docs/product/PARTNER_ORCHESTRATION_ROADMAP.md`, ADR-0007). Shared domain logic lives in packages, never duplicated between apps; `embedded-finance` stays isolated from the readiness engine.

AFLO never stores raw card numbers, CVVs, full bank-account numbers, or payment credentials — Stripe is the system of record for payment instruments and charge execution.

## Architecture Rules

1. Start as a modular monolith.
2. Separate deterministic financial logic from probabilistic AI output.
3. AI may draft, explain, summarize, classify tentatively, and ask clarifying questions.
4. AI may not directly alter financial facts, approve loans, select investments, make legal dispute decisions, determine final tax treatment, or execute transfers.
5. Every AI suggestion must include confidence, source context, and review status.
6. High-impact output requires staff review or explicit user approval.
7. Every material state change must be auditable.
8. Enforce organization-level and user-level data isolation.
9. Use synthetic data only during development.
10. Never commit secrets, production PII, credit reports, SSNs, bank records, or credentials.

## Roles

- Platform Admin (platform-level flag on `users`, never a membership; all cross-tenant access audited)
- Organization Owner
- Organization Admin (Owner minus membership and partner-directory management — see `AUTHORIZATION_MATRIX.md`)
- Staff / Advisor (Golden Key Staff)
- Client
- Partner Viewer, later

## Financial Lifecycle

1. Recovery
2. Stabilization
3. Credit Readiness
4. Capital Readiness
5. Acquisition
6. Maintenance
7. Growth
8. Legacy

Stages are determined by versioned rules, not free-form LLM decisions.

## V1 Product Modules

- Authentication and authorization
- Organizations and memberships
- Lead and client CRM
- Client onboarding and intake
- Financial profile
- Credit profile with manual score entry and report upload
- Goals
- Readiness-stage engine
- Roadmaps, milestones, and tasks
- Monthly action plans
- Contextual education
- Documents and review states
- Appointments and reminders
- Quarterly progress reports
- Partner directory and referrals
- Admin notes and communication history
- Automated communications (Resend) with consent, templates, and delivery logging
- Billing: service packages, invoices, subscriptions, and payments via Stripe (test mode until founder-approved packages and live credentials exist)
- Engagement and retention analytics
- Virtual round-up / micro-allocation simulator
- Administrative settings layer (configurable pipeline stages, service packages, task/roadmap/email templates, education modules, appointment types, staff assignments, partner categories, billing terms, reminder schedules)
- Audit and consent records

## Credit Intelligence Engine

A bounded orchestrator with **twelve** logical sub-agents (full boundaries in `docs/architecture/AGENT_BOUNDARIES.md`; canonical envelope in `packages/ai/src/envelope.ts`):

- `intake-completeness-agent`: identifies missing fields/documents; produces clarification requests.
- `credit-profile-agent`: summarizes verified credit information; flags facts requiring staff verification.
- `utilization-agent`: deterministic utilization calculations and thresholds; never guarantees score impact.
- `payment-history-agent`: organizes user-entered/uploaded history; flags inconsistencies; never contacts creditors.
- `debt-obligation-agent`: summarizes balances and monthly obligations; supports readiness calculations.
- `readiness-stage-agent`: applies versioned deterministic stage rules; returns reason codes; cannot silently override human-approved exceptions.
- `roadmap-agent`: drafts a roadmap from approved facts and templates; no legal or regulated decisions.
- `education-agent`: selects education relevant to the current stage and task.
- `engagement-agent`: detects inactivity, incomplete tasks, missed reviews, missing documents.
- `report-agent`: drafts quarterly progress summaries from verified data.
- `partner-routing-agent`: applies approved eligibility/routing gates; never approves loans or guarantees acceptance.
- `compliance-guard-agent`: runs last over proposed outputs; blocks prohibited claims/actions (hard stop).

These are logical sub-agents behind one orchestration service, not independently privileged autonomous services. They may propose actions but cannot execute regulated or irreversible actions, and cannot override deterministic outcomes.

Each agent response must use the typed envelope containing:

- `agent_name`, `agent_version`
- `organization_id`, `client_id`
- `status`, `confidence`
- `facts_used`, `missing_facts`
- `rule_versions_used`, `reason_codes`
- `proposed_actions`
- `prohibited_actions_detected`
- `requires_human_review`, `review_status`
- `created_at`

A non-empty `prohibited_actions_detected` forces `status: "blocked"`, writes an audit event, and keeps the output out of every review queue.

## Inspiration Boundaries

Study public product patterns from services such as Acorns and credit-monitoring platforms only for general UX concepts such as onboarding, progress visibility, round-up simulation, alerts, and education. Do not copy proprietary code, branding, screens, wording, trade dress, or private workflows. Build original AFLO components and interactions.

## Initial Visual Direction

Build a restrained, basic frontend first:

- Obsidian or charcoal
- Warm ivory
- Muted gold
- Deep emerald
- Slate gray
- Spacious layout
- Strong typography
- Minimal charts
- Clear stage and next-action display
- No generic AI gradients, robots, crypto imagery, or excessive glassmorphism

## Required First Vertical Slice

Build a working visual prototype with synthetic data that supports:

1. Staff sign-in shell
2. Golden Key dashboard
3. Lead/client list
4. Client profile
5. Current readiness stage
6. Current goal
7. Roadmap milestones
8. Monthly actions
9. Document status
10. Next appointment
11. Engagement status
12. Quarterly report preview

The frontend may use mock repositories first, but define interfaces that can be replaced by Neon-backed implementations.

## Delivery Method

For each implementation cycle:

1. Read existing docs and code before changing anything.
2. State the problem and intended vertical slice.
3. Create or update architecture decision records when decisions change.
4. Implement the smallest complete slice.
5. Add tests.
6. Run type checking, linting, tests, and build.
7. Document environment variables and migrations.
8. Commit with a small descriptive message.
9. Open or update the pull request.
10. Merge under the standing auto-merge authorization only when **all** gates pass — CI green; typecheck, lint, unit/integration and critical Playwright tests, and production build all pass; no secrets; no real PII; tenant-isolation tests pass; no destructive migration; no regulated activity introduced; inside the approved roadmap; deployment docs current. Otherwise open the PR, document the risk, and wait for founder review. **Never** auto-merge destructive production migrations, payment-webhook-verification changes, authorization/tenant-isolation boundary changes without tests, real-money logic outside Stripe, bureau integrations, automated disputes, tax filing, investment execution, lending decisions, government-benefit submissions, or anything that weakens sensitive-data controls.

## First Deliverables

1. Repository scaffold
2. Architecture overview
3. V1 scope and exclusions
4. Database schema proposal
5. Authorization matrix
6. Agent boundary specification
7. Synthetic seed data
8. Basic Golden Key dashboard visual
9. CI checks
10. Vercel, Railway, and Neon deployment notes

## Definition of Done for the First Visual

- The app runs locally.
- The app builds successfully.
- The dashboard renders responsive synthetic client data.
- Navigation reaches client list and client detail.
- The client detail clearly shows stage, next action, roadmap, progress, and document status.
- No real financial data is used.
- No regulated action is implied or executed.
- The code is organized for later Neon integration.

Begin by auditing the repository, writing the architecture plan, scaffolding the monorepo, and producing the first basic visual. Stop and document any blocker rather than inventing credentials or external integrations.