# ΛFLO

**Autonomous Financial Lifecycle Orchestrator** (technical / plain-text name: **AFLO**)

ΛFLO is the financial control plane for readiness, retention, and trusted financial progress. The first implementation is **Golden Key Wealth, powered by ΛFLO**: a multi-tenant platform that helps staff organize leads and clients, run structured intake, assess readiness with deterministic rules, generate roadmaps and monthly actions, deliver contextual education, track documents and appointments, publish quarterly reports, route clients to licensed partners with recorded neutrality, and hand a client's verified position to a consented professional as a cryptographically signed package.

> **Brand.** The display brand is **ΛFLO** (Greek capital lambda + FLO); the technical/plain-text name is **AFLO**. Product UI, marketing, reports, and the Wealth Academy use ΛFLO; repo/package names (`@aflo/*`), source, env vars, database identifiers, URLs, APIs, logs, and accessibility fallbacks use AFLO. Full rules: `docs/design/BRAND_SYSTEM.md §0`.

## Long-Term Thesis

Consumers possess financial context but lack structure. Institutions possess structure but lack context. ΛFLO becomes the trusted preparation, translation, and verification layer between them — it **orchestrates and routes** to licensed partners, and never becomes the lender, card issuer, custodian, or bureau itself (ADR-0007).

## Core Principles

- Deterministic rules decide stages, calculations, thresholds, and gates; AI only drafts, explains, classifies tentatively, and asks clarifying questions.
- High-impact output requires staff review or explicit user approval; every material state change is auditable.
- Multi-tenant with organization- and user-level data isolation from day one.
- An internal readiness stage is never presented as, or merged with, a credit-bureau score.
- Never store real credit reports, SSNs, bank data, credentials, or production PII in the repository — development uses synthetic data only.

## Stack

- pnpm-workspaces monorepo · Next.js App Router + TypeScript (strict) · Tailwind CSS
- Vercel (web) · Railway (worker) · Neon PostgreSQL · Drizzle ORM (ADR-0005)
- Clerk via `packages/auth` (ADR-0006) · Stripe (invoices/subscriptions/payments)
- Resend (email) · Vercel Blob or S3-compatible document storage (signed URLs) · PostHog · Sentry
- Provider-neutral AI (`mock` / Claude / OpenAI) via `packages/ai`

Vitest (unit) and Playwright (critical e2e) run in CI, along with typecheck, lint, and production build.

## Repository Structure

```text
apps/
  web/            # Next.js application deployed to Vercel
  worker/         # Background jobs deployed to Railway
packages/
  config/         # shared TypeScript + ESLint base config
  rules/          # dependency-free deterministic kernel + rule registry   [active]
  ai/             # agent envelope + provider interface                    [active]
  shared/         # domain model, mutable store, mock repositories         [active]
  billing/        # deterministic billing kernel (state machines)          [active]
  database/       # Neon schema, Drizzle models, offline migration         [active; connection gated]
  auth/           # auth provider adapter + fail-closed session guards      [active; Clerk activation gated]
  notifications/  # consent-gated delivery, templates, channel preferences [active]
  academy/        # ΛFLO Wealth Academy: catalog + assignment rules        [active]
  partner-marketplace/  # tracked referrals + Partner Neutrality Engine    [active]
  security/       # canonical JSON, Ed25519 signing, signed handoff pkgs   [active]
  ui/             # shared design-system components                        [stub]
  reports/        # report assembly (report workflow currently in shared)  [stub]
  analytics/      # PostHog instrumentation                                [stub]
  credit-data/               # provider-neutral bureau adapters   [stub, gated — next]
  opportunity-intelligence/  # opportunity & risk feed            [stub, gated]
  embedded-finance/          # future-only partner boundary       [stub, gated]
  integrations/              # external-provider adapters         [stub]
docs/
  business-plan/  product/  architecture/  adr/
  compliance/     research/  design/       deployment/
```

Packages marked *[stub]* are inert placeholders (manifest + README) that gain content only when their activating vertical slice and gates clear (ADR-0004, ADR-0007). Gated stubs stay isolated from the readiness engine.

## What's built (synthetic V1)

The app runs a broad Golden Key workflow on the in-memory `AfloStore` over synthetic data — every mutation is rules-gated, event-emitting (PostgreSQL-outbox contract), append-only audited, and organization/actor scoped:

- Staff sign-in shell, dashboard, lead pipeline, client list, and client detail
- Lead → client conversion, structured intake, and readiness assessment (deterministic stage rules + review gate)
- Goals, roadmap approval workflow, monthly action plans, documents, appointments, notes
- Quarterly report generation → review → publish, and a published-only client portal
- Consent-gated communications with per-channel notification preferences
- **ΛFLO Wealth Academy** — versioned catalog, deterministic trigger→lesson assignment, knowledge checks
- **Partner referrals + Partner Neutrality Engine** — tracked lifecycle, the eight-field neutrality record on every recommendation, compensation-neutral ordering (ADR-0010)
- **Signed verification handoff packages** — Ed25519-signed packages of verified facts with recipient/consent scope, expiration, revocation, and fail-closed verification (ADR-0009)
- Virtual round-up / micro-allocation simulator (simulation only) and a deterministic billing kernel

## Not yet wired (credential- or account-gated)

The store is still mock-backed; the durable production runtime is the next milestone. These wait on founder-provided credentials/accounts and are documented in `docs/product/BUILD_STATUS.md` and `docs/deployment/`:

- **Neon connection + repository swap** (`DATABASE_URL`) — replace the in-memory store with Neon-backed repositories; add database-level RLS
- **Clerk activation** (keys) — the auth boundary is implemented; real sessions/memberships need credentials
- **Railway worker** — the outbox/retry rules exist; durable event processing needs the shared database
- **Resend / Twilio** — preference + consent routing is built; live email/SMS delivery needs keys
- **Stripe test mode** — the billing kernel is pure; customer/invoice/subscription/webhook wiring needs keys and founder-approved packages
- **Document storage** — private object storage, signed URLs, scanning, and retention

## Getting Started

```bash
pnpm install
pnpm dev        # Next.js app at http://localhost:3000 (synthetic data; no env vars needed)
pnpm typecheck  # tsc across all workspaces
pnpm lint       # eslint across all workspaces
pnpm test       # vitest (rules, kernels, store)
pnpm build      # worker + web production builds
pnpm --filter web test:e2e   # Playwright critical flows (build first)
```

## V1 Boundaries

V1 does not include direct bureau pulls, automated credit disputes, tax filing, investment selection, real-money transfers outside Stripe, banking-as-a-service, loan underwriting, insurance sales, or government-benefit submissions. Signed handoff packages are tamper-evident data packages — not "audit-proof", "legally verified", "underwriting-approved", or "zero-knowledge".

## Documentation

Authoritative sources, in precedence order: approved founder decisions (`docs/product/FOUNDER_DIRECTIVE_2026-07-18.md`), the Product Charter (`docs/product/PRODUCT_CHARTER.md`), `CLAUDE.md`, then accepted ADRs (`docs/adr/`), architecture, V1 scope, the partner-orchestration roadmap, and the business-plan digest. Live build state: `docs/product/BUILD_STATUS.md`.
