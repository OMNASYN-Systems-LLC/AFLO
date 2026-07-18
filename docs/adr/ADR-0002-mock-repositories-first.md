# ADR-0002: Mock Repositories First, Neon Later

## Status

Accepted — 2026-07-17

## Context

The required first vertical slice is a **visual prototype on synthetic data**: staff dashboard, lead/client list, client detail, readiness stage, roadmap, monthly actions, document status, appointments, engagement status, and quarterly report preview.

The execution brief allows this explicitly: "The frontend may use mock repositories first, but define interfaces that can be replaced by Neon-backed implementations." It also mandates synthetic data only during development and forbids real financial data, credentials, or production PII in the repository.

Standing up Neon, migrations, and row-level tenancy enforcement before the information hierarchy is validated would slow the first slice and invite churn: the schema is still a proposal, and the workflow it serves has not yet been reviewed by Golden Key staff.

## Decision

The first visual slice runs entirely on **typed repository interfaces with in-memory synthetic implementations**, defined in `packages/shared`:

- Each domain aggregate gets a repository interface (e.g., `ClientRepository`, `RoadmapRepository`, `DocumentRepository`, `EngagementRepository`) whose methods take and return typed domain models — never raw rows, never ORM entities.
- Every tenant-scoped read/write method requires an explicit `organizationId` parameter from day one, so tenancy scoping is part of the contract before a database exists.
- The in-memory implementations are seeded from deterministic synthetic fixture data (no `Math.random()` in fixtures; stable IDs so UI states are reproducible).
- `apps/web` and `apps/worker` receive repositories through a single composition point (a small factory/container), so swapping implementations is a one-line change per repository, not a codebase-wide edit.
- Neon-backed implementations will later live in `packages/database` and implement the **same interfaces** with organization scoping enforced (repository policy and/or PostgreSQL RLS) before any pilot data is introduced.

```text
apps/web ──▶ Repository interfaces (packages/shared)
                   ├── InMemory* implementations + synthetic fixtures   (V1 slice)
                   └── Neon* implementations (packages/database)        (later, same contract)
```

## Consequences

Positive:

- The dashboard and client views ship without waiting on database provisioning, migrations, or auth wiring.
- The interface layer forces early decisions about what the UI actually needs, informing the real schema proposal.
- Tenancy (`organizationId` on every call) and review-status fields exist in the contract before persistence does, so the Neon swap cannot silently drop isolation.
- Synthetic-only data satisfies the "no real PII" rule by construction.

Required follow-through:

- **Contract tests are mandatory.** A shared test suite runs against any `Repository` implementation; the in-memory versions pass it now, and the Neon versions must pass the identical suite before replacing them. This is the guard against behavioral drift (ordering, filtering, not-found semantics, tenancy scoping) between mock and real implementations.
- In-memory implementations must not accrete features the interface does not declare (e.g., cross-organization queries for convenience); anything the mock can do, the contract test must cover.

Negative / accepted costs:

- Some rework is inevitable: pagination, transactionality, and concurrency semantics are easy to gloss over in memory and will surface during the Neon implementation.
- No persistence between restarts; demo state resets. Acceptable for a synthetic prototype.
- Query-performance characteristics are invisible until real implementations exist.

## Alternatives Considered

1. **Neon-first (schema and migrations before any UI).** Rejected: slower to the required first visual, and the schema would be designed before the staff workflow validated the information hierarchy.
2. **Hardcoded fixtures inside React components (no repository layer).** Rejected: the brief requires replaceable interfaces; page-level fixtures would make the Neon swap a rewrite instead of a substitution.
3. **SQLite/local Postgres as the interim store.** Rejected for the first slice: adds migration and setup overhead without validating anything the in-memory implementations do not, while still differing from Neon in the ways that matter (RLS, serverless connection behavior).
