# ADR-0001: Modular Monolith over Early Microservices

## Status

Accepted — 2026-07-17

## Context

AFLO V1 ("Golden Key Wealth, powered by AFLO") is being built by a very small team that needs to reach a working staff-facing visual slice quickly: dashboard, client list, client detail, readiness stage, roadmap, monthly actions, documents, and quarterly report preview.

At the same time, the long-term product direction (financial readiness engine, credit intelligence, reporting, partner routing, and eventually the business plan's institutional middleware phases) implies that some domains — rules evaluation, AI orchestration, report generation — may eventually need independent scaling or operational isolation. The business plan's own roadmap defers any microservices transformation to a later phase; V1 explicitly must not pay a distributed-systems tax up front.

The execution brief (CLAUDE.md) mandates: "Start as a modular monolith" and "Deliver in small, reviewable vertical slices."

## Decision

Build AFLO as a **modular monolith** with exactly two deployables:

| Deployable | Platform | Responsibility |
|---|---|---|
| `apps/web` | Vercel | Next.js UI, server actions, short request/response APIs, report preview, upload authorization |
| `apps/worker` | Railway | Scheduled jobs, quarterly report generation, notification queues, document processing, AI job execution, retries/dead-letter |

Both deployables share domain code through workspace packages (see ADR-0004). Domain boundaries are expressed **in code, not in network topology**:

- Each domain module (identity/tenancy, CRM, financial readiness, roadmaps/engagement, documents/reports, partner routing, governance) exposes a typed public interface; other modules import only that interface, never internals.
- Cross-domain communication inside the monolith goes through application services and, for asynchronous work, an outbox table polled by the worker — not direct cross-module table access.
- Neon PostgreSQL is the single multi-tenant source of truth; every tenant-owned table carries `organization_id`.

Extraction of a module into a separate service is permitted only when a concrete scale or isolation requirement appears, and requires a new ADR.

## Consequences

Positive:

- One repo, one schema, one deploy pipeline per target — fastest path to the required first visual slice.
- Refactoring across domain boundaries is a compiler-checked code change, not a coordinated multi-service release.
- Transactions and audit writes stay local to one database, which simplifies the "every material state change is auditable" rule.
- Explicit module interfaces keep later extraction (e.g., rules engine or AI orchestration as services) tractable.

Negative / accepted costs:

- Module boundaries are enforced by convention, code review, and lint rules rather than process isolation; discipline is required to prevent a "big ball of mud."
- Web and worker scale as whole units; a hot module cannot be scaled independently until extracted.
- A single shared database means schema changes touch all domains; migrations must be reviewed carefully.

## Alternatives Considered

1. **Microservices from day one.** Rejected: massive operational overhead (service discovery, distributed tracing, cross-service auth, eventual consistency) for a team that has not yet validated the workflow. The business plan itself schedules this for a later phase.
2. **Single unstructured Next.js app (no worker, no module boundaries).** Rejected: scheduled reminders, quarterly report generation, and long-running document/AI jobs do not fit serverless request limits, and an unstructured codebase would block the planned extraction path.
3. **Serverless-only with cron functions instead of a Railway worker.** Rejected: long-running AI and document jobs, retry/dead-letter handling, and queue processing are poorly served by short-lived functions; the brief specifies a Railway worker.
