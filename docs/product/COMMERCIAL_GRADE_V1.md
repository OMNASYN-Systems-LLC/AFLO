# AFLO Commercial-Grade V1 Mandate

> **Status:** Authoritative founder directive (2026-07-18), ranking directly under explicit founder decisions in the source-of-truth order. Where this mandate extends the Product Charter, this document governs; contradictions are reconciled progressively per slice, never left active.

## Definition

"Commercial-grade" supersedes "visually demonstrated": secure by default, multi-tenant by design, observable, auditable, recoverable, idempotent, testable, versioned, documented, deployable, failure-aware, configurable, accessible, responsive, maintainable, provider-neutral where practical, and safe under retries, duplicates, delays, stale data, and partial failure. **"Done" never means merely scaffolded, mocked, or visually demonstrated.** Optimize for correctness, durability, operability, and trust — not feature velocity.

## Deltas beyond the current charter (adopted, implemented progressively)

1. **Additional packages**: `events`, `workflows`, `security`, `observability`, `documents` join the existing roster. Every *active* package needs an owner, API, tests, and documentation; inert packages need an unlock condition.
2. **Workflow engine (`packages/workflows`)**: explicit versioned workflow definitions (step ids, preconditions, transition rules, compensation, retry/timeout policies, human-review checkpoints, failure states) over PostgreSQL state + outbox. Fifteen priority workflows enumerated in the mandate (lead-to-client conversion → data export/deletion). No Temporal or external engine without measured evidence.
3. **Expanded event catalog**: adds `ConsultationScheduled`, `IntakeSectionCompleted`, `RoadmapReviewed`, `RoadmapPublished`, `TaskVerified`, `AppointmentCompleted`, `ReengagementRequested`, `ProgressReportApproved`, `PartnerReferralUpdated`, `EmailRequested/Delivered/Failed`, `AgentRunRequested/Completed/Failed`, `DataExportRequested`, `DataDeletionRequested`; envelope gains `schema_version`. Catalog grows with the slice that emits each event — never speculatively.
4. **Hierarchical agent system**: one Financial Lifecycle Orchestrator coordinating department-scoped agents (credit intelligence, roadmap/behavior, education, documents, partner orchestration, communications, billing, compliance/safety, operations) with the expanded output contract (run/workflow ids, tools_used, warnings, timing, error_code, correlation/causation) and durability requirements (persistence, idempotency, timeout, retries, schema validation, circuit breakers, cost telemetry). **Guardrail from the same mandate: do not overbuild agents before the underlying workflows and verified data exist** — agents attach to real workflow boundaries with measurable value.
5. **Provider synchronization framework** (`packages/integrations`): adapter contract with cursors/watermarks, sync status, idempotency, source-of-truth declarations, drift detection, reconciliation jobs; webhooks are never assumed complete or ordered.
6. **Observability/SRE baseline**: structured logs with correlation/org/workflow ids, health/readiness endpoints, worker heartbeat, runbooks (incidents, secret rotation, DB recovery, webhook/dead-letter replay), kill switches for every external integration, feature flags, maintenance mode.
7. **Expanded quality gates**: dependency audit, secret scan, PII scan, tenant-isolation tests, accessibility checks on critical screens, migration checks — all in CI; red CI never merges.
8. **Support Access role** only if explicitly designed and audited (not yet designed).

## Execution priority (founder order)

C2 staff lead conversion → D client intake → E readiness assessment → F roadmap approval → G monthly actions → H quarterly reports → client portal → staff workflow completion → Clerk auth → Neon persistence → outbox worker → Resend notifications → Academy → admin settings → Stripe test-mode billing → partner marketplace → observability hardening → deployment/pilot verification.

## Unchanged

Stop conditions, auto-merge policy boundaries, V1 exclusions, multi-tenancy invariants, deterministic-core rules contract, AI prohibitions, brand system, and the partner-orchestration gates all carry forward exactly as previously recorded.
