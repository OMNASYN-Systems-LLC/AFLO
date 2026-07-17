# Claude Execution Brief — AFLO

You are the principal software architect and implementation partner for AFLO, the Autonomous Financial Lifecycle Orchestrator.

## Product Mission

Build **Golden Key Wealth, powered by AFLO** as the first production implementation. The initial product is a multi-tenant financial-readiness, client-retention, and workflow platform. Long term, AFLO may become a financial verification and interoperability layer, but V1 must solve Golden Key Wealth's actual operating problems first.

## Immediate Objective

Create a secure, testable, production-oriented foundation that reaches a basic visual frontend quickly while preserving the architecture required for future credit intelligence, financial readiness, reporting, partner routing, and autonomous workflow support.

Do not attempt to build every long-term feature at once. Deliver in small, reviewable vertical slices.

## Required Stack

- Monorepo
- Next.js + TypeScript web application deployed to Vercel
- Railway worker service for scheduled jobs and long-running processing
- Neon PostgreSQL
- Tailwind CSS
- Clerk or Auth.js
- Vercel Blob or S3-compatible document storage
- Resend
- PostHog
- Sentry
- Claude or OpenAI API behind an internal provider interface

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

## First Roles

- Platform Admin
- Organization Owner
- Golden Key Staff
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
- Engagement and retention analytics
- Virtual round-up / micro-allocation simulator
- Audit and consent records

## Credit Intelligence Engine

Design a bounded credit intelligence system with these components:

- `credit-profile-agent`: summarizes verified profile data and identifies missing inputs.
- `utilization-agent`: calculates utilization and tests deterministic threshold rules.
- `payment-history-agent`: summarizes user-entered or uploaded history without making disputes.
- `readiness-agent`: evaluates versioned readiness rules and returns reason codes.
- `roadmap-agent`: drafts a roadmap from approved facts and deterministic outputs.
- `education-agent`: selects relevant educational content.
- `engagement-agent`: detects inactivity and recommends follow-up.
- `report-agent`: drafts quarterly progress summaries.

These are logical sub-agents behind one orchestration service, not independently privileged autonomous services. They may propose actions but cannot execute regulated or irreversible actions.

Each agent response must use a typed schema containing:

- `status`
- `confidence`
- `facts_used`
- `rules_used`
- `reason_codes`
- `recommendations`
- `requires_review`
- `prohibited_action_detected`

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
9. Open a draft PR for review.
10. Never merge automatically unless explicitly directed.

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