# ADR-0005: Drizzle ORM for the Neon PostgreSQL Layer

## Status

Accepted — 2026-07-17

## Context

The product charter names **Drizzle ORM** as the default "unless a written ADR shows a stronger reason for Prisma." This ADR confirms the default rather than overturning it.

The database layer AFLO actually needs is already specified in SQL terms:

- The schema proposal (`docs/architecture/DATABASE_SCHEMA.md`) is SQL-first DDL: Postgres enums, `pgcrypto` UUIDs, a shared `updated_at` trigger, and composite indexes leading with `organization_id`.
- The migrations policy (schema doc §11, applied per `docs/deployment/DEPLOYMENT.md`) requires plain, reviewable SQL files in `packages/database/migrations/`, forward-only, applied by CI to Neon preview branches via `DIRECT_DATABASE_URL` and to production only as a manual, reviewed job.
- Row-level security is hand-written SQL: `CREATE POLICY` per tenant-owned table plus transaction-scoped `set_config('app.current_org_id', ...)` / `set_config('app.current_user_id', ...)` plumbing. No ORM abstraction may own or obscure this.
- Runtime targets are Vercel serverless functions (Neon serverless/pooled driver) and the Railway worker; neither should require a native query-engine binary in its build or image.
- ADR-0002 fixed the repository interfaces in `packages/shared`; whatever persistence tool we pick must live entirely inside `packages/database` behind those interfaces.

## Decision

Adopt **Drizzle ORM** as the persistence layer in `packages/database`, used with the Neon serverless driver at runtime and the direct connection for migrations.

- **Schema as TypeScript, migrations as SQL.** The Drizzle schema definitions in `packages/database` are the source of truth for tables, enums, and indexes. `drizzle-kit generate` emits plain SQL migration files that are checked into `packages/database/migrations/` and reviewed like any hand-written SQL — the migration file, not the generator, is the artifact of record.
- **Hand-written SQL stays first-class.** RLS enablement and policies, the `set_updated_at` trigger, `set_config` session-variable plumbing, and multi-step enum changes are authored directly in migration files (generated files may be edited before commit). Drizzle is never allowed to "manage" RLS; it only has to coexist with it, which it does because it executes ordinary SQL under the `aflo_app` role.
- **Application policy unchanged.** Migrations are applied exactly per DEPLOYMENT.md: CI against Neon PR/preview branches, manual reviewed dispatch for production. No `drizzle-kit push` against any shared environment.
- **Types flow outward, entities do not.** Model types inferred from the Drizzle schema (`$inferSelect` / `$inferInsert`) feed the domain types in `packages/shared`, keeping the schema doc, the database, and the TypeScript contract from drifting apart. Repository methods still take and return domain models per ADR-0002 — Drizzle rows never cross the package boundary.
- **Repositories swap behind unchanged interfaces.** The Neon-backed implementations replace the in-memory ones from ADR-0002 one at a time, passing the same contract-test suite, with the transaction-start tenant-context calls owned by the repository layer.

## Consequences

Positive:

- No engine binary or codegen'd runtime: Drizzle is plain TypeScript over the driver, which suits Vercel functions and keeps the Railway worker image simple.
- Generated SQL migrations satisfy the "reviewable SQL, no ORM-generated drift" policy while still automating the tedious diffing.
- Inferred types eliminate a whole class of schema/type mismatch bugs without a parallel schema DSL to maintain.
- Query building stays close to SQL, so the tenant-scoped composite-index access paths in the schema doc are expressible without fighting the tool.

Negative / accepted costs:

- Two schema representations exist (Drizzle TypeScript and the illustrative DDL in the schema doc); the Drizzle schema is authoritative and the doc must be kept reconciled at review time.
- Generated migrations require human editing for anything Drizzle doesn't model (policies, triggers, enum renames); reviewers must treat every generated file as hand-written.
- Drizzle's ecosystem is younger than Prisma's; some conveniences (e.g., mature seeding/studio tooling) are thinner and may need small amounts of our own glue.

## Alternatives Considered

1. **Prisma.** Rejected: heavier runtime (query engine, generated client) on serverless and in the worker image; its schema DSL sits further from our SQL-first schema and migrations docs; and hand-written RLS plus session-variable SQL is a documented friction point in Prisma's migration flow. The charter default stands — no stronger reason for Prisma emerged.
2. **Raw SQL only (driver + hand-rolled mappers).** Rejected: loses type inference and migration diffing entirely; every table means hand-maintained types and mapping code, which is exactly the drift the shared contract is meant to prevent.
3. **Kysely (typed query builder, no schema/migration tooling).** Rejected: closest competitor, but types are maintained or codegen'd separately from migrations, so it offers less than Drizzle for the same discipline cost.
