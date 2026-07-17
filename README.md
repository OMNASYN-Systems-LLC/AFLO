# AFLO

**Autonomous Financial Lifecycle Orchestrator**

AFLO is the financial control plane for readiness, retention, and trusted financial progress. The first implementation is **Golden Key Wealth, powered by AFLO**: a multi-tenant platform that helps staff organize leads and clients, generate personalized roadmaps, assign monthly actions, deliver contextual financial education, track progress, improve retention, and route clients to qualified partners.

## Initial Product Wedge

Credit Recovery and Financial Readiness Management for Golden Key Wealth.

## Long-Term Thesis

Consumers possess financial context but lack structure. Institutions possess structure but lack context. AFLO becomes the trusted preparation, translation, and verification layer between them.

## Core Principles

- Start with a narrow, real workflow.
- Use deterministic rules for stages, calculations, thresholds, and gates.
- Use AI for context, drafting, explanations, and clarification.
- Require human review or explicit user approval for high-impact guidance.
- Build multi-tenant with strict data isolation from day one.
- Never store real credit reports, SSNs, bank data, credentials, or production PII in the repository.

## Planned Stack

- Next.js + TypeScript
- Vercel
- Neon PostgreSQL
- Railway workers
- Tailwind CSS
- Clerk or Auth.js
- Vercel Blob or S3-compatible storage
- Resend
- PostHog
- Sentry
- Claude or OpenAI API

## Repository Structure

```text
apps/
  web/        # Next.js application deployed to Vercel
  worker/     # Background jobs deployed to Railway
packages/
  database/
  auth/
  ui/
  rules/
  ai/
  reports/
  notifications/
  analytics/
  shared/
docs/
  business-plan/
  product/
  architecture/
  compliance/
  research/
  design/
```

## Current Status

First vertical slice implemented: pnpm monorepo scaffold, deterministic readiness/engagement rules with tests, mock repositories over synthetic data, and the staff-facing visual prototype (sign-in shell, dashboard, client list, client detail). Architecture, scope, schema, authorization, agent-boundary, and deployment docs are in `docs/`. No external services are wired yet — the prototype needs no environment variables.

## Getting Started

```bash
pnpm install
pnpm dev        # Next.js app at http://localhost:3000
pnpm typecheck  # tsc across all workspaces
pnpm test       # vitest (rules engine + repositories)
pnpm lint       # eslint (web)
pnpm build      # worker + web production builds
```

## V1 Boundaries

V1 does not include direct bureau pulls, automated credit disputes, tax filing, investment selection, real-money transfers, banking-as-a-service, loan underwriting, insurance sales, or government benefit submissions.
