# ADR-0008: Domain Event Envelope and PostgreSQL Outbox Contract

## Status

**Accepted** — 2026-07-18 (founder-directed client-lifecycle workstream, slices A–B)

## Context

The client-lifecycle workstream requires every material state change to emit an auditable business fact that background work (reminders, emails, reports, engagement checks, AI jobs) can consume reliably. The charter mandates a PostgreSQL outbox — explicitly no Kafka or other broker in V1 — with idempotent, organization-scoped processing by the Railway worker. Events also underpin audit trails and, long-term, the verification/interoperability layer.

Two contracts had to be fixed early, because everything downstream (worker, notifications, reports, engagement) builds against them: the event envelope shape and the outbox record/transition semantics.

## Decision

**1. One envelope for every domain event** (`packages/shared/src/events`):

- A closed catalog of PascalCase past-tense event types (25 at adoption: `LeadCreated` … `ConsentRevoked`), each with a per-type `event_version` (all start at 1; bump on incompatible payload change — consumers decode by `(event_type, event_version)`).
- Envelope fields: `event_id`, `event_type`, `event_version`, `organization_id`, `aggregate_type`, `aggregate_id`, `actor_id` (null = system), `occurred_at`, `correlation_id` (one causal chain, e.g. a user action; roots default to their own id), `causation_id` (direct-cause event id; null at roots), `payload`.
- Payloads are typed per event with a compile-time exhaustiveness guarantee; they carry domain deltas only — tenancy/actor/causality never duplicate into payloads. Pipeline statuses are strings referencing configurable org settings.
- `createEvent` derives the aggregate type from the catalog and **fails closed** on tenant-less or structurally invalid events; serialization is deterministic (deep-sorted keys) so idempotency hashes are stable.

**2. Transactional outbox as the only event transport** (`packages/shared/src/outbox`, DDL in `DATABASE_SCHEMA.md` §9.4):

- Producers insert the outbox row in the same transaction as the state change; the payload column stores the full serialized envelope; `event_id` is unique (producer-side idempotency), `id` keys handler idempotency, `${event_type}:${event_id}` dedupes consumers.
- Statuses: `pending → processing → processed | failed → (retry) | dead_letter`. Transitions are the deterministic, versioned `outbox.v1.0.0` pure functions — `claim` (only when `next_attempt_at` has passed; increments `attempts`; records the worker lock), `complete`, `fail` (mandatory failure reason; exponential backoff 30s·2ⁿ capped at 1h; `dead_letter` once `attempts ≥ max_attempts`). Reason codes on every decision; the worker applies rule output, never improvises state.
- Workers poll with `SELECT … FOR UPDATE SKIP LOCKED`; handlers are idempotent under re-delivery (crash between claim and complete re-runs the handler); no job executes without organization context (the envelope requires it).

## Consequences

Positive: exactly-once *effects* via at-least-once delivery + idempotent handlers, all inside PostgreSQL transactions; complete causal audit chains (`correlation_id`/`causation_id`); typed payloads keep producers and the worker honest; the deterministic transition rules are unit-tested apart from any database.

Negative / accepted: outbox polling adds write-path rows and a polling loop (fine at V1 scale; measured evidence required before any broker per the charter); per-type versioning discipline is manual — schema changes must bump `EVENT_VERSIONS` and keep old decoders until drained.

## Alternatives Considered

1. **Kafka / SQS / broker** — rejected by charter; operational surface unjustified at V1 scale.
2. **Postgres LISTEN/NOTIFY as transport** — rejected as primary: no durability or retry; may later *supplement* polling latency.
3. **Untyped JSON events** — rejected: loses compile-time payload safety and versioned decoding, inviting silent consumer drift.
