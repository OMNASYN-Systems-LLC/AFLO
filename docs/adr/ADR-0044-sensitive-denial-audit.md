# ADR-0044: Messaging routes + mandatory sensitive-denial audit emission (Workstream B9)

## Status

**Accepted** — 2026-07-23 (founder continuation directive 2026-07-22,
Workstream B item 9; founder decision 4 — resolved by this slice)

## Context

ADR-0036 shipped the `AuthorizedMessagingService` gate with an explicit
deferral: sensitive denials threw without any audit record, tracked to land
"with — or before — the B9 route-wiring slice, where these denials first
become reachable by real callers." Founder decision 4 then made the
obligation non-negotiable and precise:

> Sensitive-denial audit emission is mandatory in the Clerk activation and
> route-enforcement work. The obligation is not optional or indefinitely
> deferred. Sensitive denials include: cross-tenant access; wrong-client
> access; ownership mismatch; staff-assignment mismatch; revoked membership;
> disabled account; revoked client link; ambiguous identity; invalid
> organization context; platform-admin cross-tenant access; attempted
> publication without authority. External responses remain anti-oracle and
> uniform. Internal audit records preserve the distinct denial reason.

This slice wires the six messaging routes AND discharges that obligation in
the same change — the denials become reachable and auditable together.

## Decision

### 1. `DrizzleAuditEventRepository` (`packages/database/src/repositories/audit-events.ts`)

Append-only repository over the EXISTING `audit_events` table (migration
0000; FORCE-RLS `org_isolation` since 0003 — **no new migration**: every
needed column already exists). Tenant connection, every op inside
`withOrgContext`, so the audit trail itself is tenant-isolated — readable and
writable only under the owning org. Surface: `record(event)` and a
TESTS-ONLY `listForOrganization`; no update/delete exists. **Payload
discipline:** ids, digests, reason codes, actor/membership ids only — never
message content, subjects, tokens (raw or digest), emails, or PII.

### 2. Mandatory denial audit in `AuthorizedMessagingService`

The service takes a **REQUIRED** second constructor dependency,
`MessagingDenialAuditSink` (interface declared in the service file;
implemented by the audit repository). Every denial path now runs
**emit-then-throw**: one audit event carrying the DISTINCT internal reason,
then the UNCHANGED `MessagingAccessDeniedError` (same engine reason code,
same permission — external behavior byte-identical to before, and route
responses byte-identical to not-found). An audit-write failure can never
suppress the denial: the write is wrapped, the denial still throws, and the
failure surfaces only through the injected `onAuditFailure` secondary-error
channel (default: `console.error`). Denials only — happy paths and plain
not-found emit nothing.

**Denial-category mapping** (engine reason → founder category; audited as
`reason_code` on action `messaging.access_denied`):

| Engine reason (external, unchanged)      | Internal audit category               |
| ---------------------------------------- | ------------------------------------- |
| `cross_tenant`                           | `cross_tenant_access`                 |
| `not_owner` (thread target)              | `wrong_client_access`                 |
| `not_owner` (client target)              | `ownership_mismatch`                  |
| `not_assigned`                           | `staff_assignment_mismatch`           |
| `membership_revoked`                     | `revoked_membership`                  |
| `account_disabled`                       | `disabled_account`                    |
| `membership_pending`                     | `invalid_organization_context`        |
| `no_active_membership` (platform admin)  | `platform_admin_cross_tenant_access`  |
| `no_active_membership` (any other role)  | `invalid_organization_context`        |
| `no_active_membership`/`unauthenticated` at sender derivation | `ambiguous_identity` |
| `permission_denied` (e.g. client close)  | `publication_without_authority`       |
| `consent_required` (unreachable here)    | `publication_without_authority`       |
| `invalid_record_state` (unreachable)     | `invalid_organization_context` (fail-safe) |

Two founder categories need stating rather than branching:

- **`revoked_client_link`** is reserved vocabulary: a revoked link never
  resolves a session (the principal directory returns active links only —
  ADR-0037), so those callers 401 upstream and no messaging branch can
  observe the state. The category belongs to the session-resolution audit
  surface when it lands.
- **`cross_tenant_access`** is mapped but structurally unreachable in THIS
  service: the resource org always equals the session org (no org parameter
  exists to forge — ADR-0036), and a foreign-org thread is RLS-invisible, so
  a cross-tenant probe surfaces as the uniform not-found, not as a detectable
  denial. Where the engine CAN detect `cross_tenant` (other services), the
  mapping is ready.

**Null-org boundary (documented residual):** `audit_events.organization_id`
is NOT NULL + FORCE RLS, so a denial with NO org context (platform-admin
probe, degenerate session) cannot be a tenant row. The sink still receives
every such event (emission is unconditional and test-asserted); the Drizzle
implementation routes null-org events to an injected structured logger
(single-line JSON, ids/codes only) until the separate platform-plane audit
surface (ADR-0025) lands. The denial itself remains fail-closed either way.

### 3. Messaging routes (`apps/web/src/app/api/messages/…`)

Tested route services in `@aflo/database/services/messaging-routes.ts`
(injected session provider + gate service + clock, the B4/B6 idiom) + THIN
Next.js compositions via `lib/messaging-runtime.ts` (the `auth-runtime.ts`
extraction pattern): 503 `not_configured` unless AUTH_MODE=clerk +
REPOSITORY_MODE=postgres + both role-scoped DB URLs + a well-formed
`FIELD_ENCRYPTION_KEY`; `runtime="nodejs"`, `dynamic="force-dynamic"`,
`no-store`; 401 while the Clerk closure is uncomposed (fail closed, inert in
production today).

- `POST /api/messages/threads` → `createThread`
- `GET  /api/messages/threads?clientId=…` → `listThreads`
- `GET  /api/messages/threads/[threadId]` → `getThread` + `listMessages`
- `POST /api/messages/threads/[threadId]/messages` → `postMessage`
- `POST /api/messages/threads/[threadId]/read` → `markThreadRead`
- `POST /api/messages/threads/[threadId]/status` → `setThreadStatus`

**Uniform anti-oracle 404 (deep-equality-tested):** every
`MessagingAccessDeniedError`, unknown/foreign-org id, RLS-invisible client,
and syntactically impossible (non-UUID) id renders the SAME
`{ ok:false, error:"not_found" }` — a denial is indistinguishable from a
missing thread on every route, writes included. The org is ALWAYS the
session's (the service signatures cannot express a caller org). Malformed
requests get stable 400 codes; post-authorization kernel rejections keep
their distinct `MSG_*` codes (400/409) — the caller has already proven
access, so they reveal nothing (the ADR-0042 post-terminal precedent).

### 4. ADR-0042 deferral closed early (invitation audit fold-in)

ADR-0042 bound the matrix §7 row 1 audit emission (`invitation.issued` /
`invitation.accepted`) to the Clerk-activation PR. The brief's small-clean
test was met (~60 service lines), so this slice closes that deferral EARLY:
`handleIssueInvitation`/`handleAcceptInvitation` take an
`auditSink` — optional in the type (existing tests untouched), REQUIRED in
composition (both routes inject `DrizzleAuditEventRepository`). Issuance
audits the invitation id + intended role (never the email, never the token
in any form); acceptance audits the CREATED membership/client-link row. A
failed audit write never fails the already-committed request (secondary-error
log); denials emit nothing through this sink (creation audit ≠ denial audit).
The Clerk-activation PR no longer carries this obligation.

## Consequences

- **38 new tests → 312 database tests** (PGlite, non-superuser so RLS is
  real): per-category denial→audit unit proofs (each writes exactly ONE event
  with the distinct reason; external error unchanged; happy paths and plain
  not-found emit nothing; audit failure still denies); repository RLS proofs
  (org B reads none of org A's trail; no org context reads nothing;
  cross-org forgery rejected by WITH CHECK; null-org events reach the
  structured channel and land in NO org); route-service proofs (503
  predicate + cipher fail-closed, 401 on every handler, stable 400s, kernel
  400/409, happy paths, and the deep-equality anti-oracle across
  unknown/foreign/denied/malformed on every route); full-table dump proving
  audit rows never contain message bodies or subjects; invitation fold-in
  proofs (issued/accepted rows without email/token, commit-wins on audit
  failure, no denial emission).
- The messaging surface is now route-complete and inert-safe: every request
  503s (unconfigured) or 401s (no Clerk closure) in production today;
  activation remains pure composition (ADR-0042).
- Same audit-sink pattern queued for the other client-owned route families
  (documents, appointments, reports) as their gate services land — the
  founder's category vocabulary and the repository are shared infrastructure.
- The platform-plane audit surface (ADR-0025) still owes durable persistence
  for null-org denials; the structured-log channel here is the tracked
  interim (this paragraph is the pointer).
