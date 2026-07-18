# @aflo/database

Neon PostgreSQL schema as code (Drizzle ORM, ADR-0005) and SQL migrations.

## What lives here

- **`enums`** — Postgres enum types. Kernel-owned enums (lifecycle stage, roadmap/report/document/action status, consent type) are built **directly from the deterministic constant arrays** in `@aflo/rules` / `@aflo/notifications`, so the database and the rules can never disagree. The rest are declared here as the canonical list and lockstep-tested against the domain types.
- **`schema`** — the core tables: identity (`users`), tenancy (`organizations`, `organization_members`), governance (`consent_records`, `rule_versions`, `audit_events`, `outbox`), and CRM (`clients`, `intakes`). Reconciled to the **implemented** model (slices C–M): leads and clients are one `clients` table keyed by `client_kind` with a configurable `pipeline_stage_id`, not the original proposal's separate tables + `lead_status` enum.
- **`migrations/`** — generated SQL (`drizzle-kit generate`, offline, no connection needed).

## PII

No raw PII is ever stored: `phone` and `date_of_birth` are application-layer-encrypted `bytea` (ciphertext only); no card, SSN, or bank-account data is modeled at all (charter).

## Not in this slice (follow-up, gated on DATABASE_URL)

- The workflow tables (`readiness_assessments`, `roadmaps`, `monthly_actions`, `documents`, `appointments`, `quarterly_reports`, `notes`, `communications`).
- The Neon connection (`drizzle` client) and the Neon-backed repository implementations that replace the mocks behind the unchanged `@aflo/shared` interfaces (ADR-0002).

`db:generate` runs offline in CI. `db:migrate`/`push` need `DATABASE_URL` (Neon, per-branch), run only from the deploy pipeline; the URL enters via the provider dashboard, never the repo.
