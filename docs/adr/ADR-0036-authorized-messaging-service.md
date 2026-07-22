# ADR-0036: Authorization-gated messaging service (Workstream B8, task #61)

## Status

**Accepted** — 2026-07-22 (founder continuation directive 2026-07-22,
Workstream B item 8: authorization enforcement)

## Context

The messaging stack deliberately split responsibilities: the
`MessagingRepository` (ADR-0028) owns TENANT isolation (RLS via
`withOrgContext`) and WELL-FORMEDNESS (kernel re-checks, thread-derived
`clientId`), while cross-principal authorization — which client owns the
thread, which staff are assigned, who may close — was explicitly left to the
authorization engine (ADR-0018). That gap had to close before any client
portal or staff route touches the persistent repositories: without it, any
authenticated principal in an org could read any same-org client's thread.

## Decision

`packages/database/src/services/authorized-messaging.ts` —
`AuthorizedMessagingService`, a gate that wraps any `MessagingRepository` and
takes the caller's `SessionContext` per call. Three properties are
STRUCTURAL (unrepresentable, not merely checked):

1. **No caller-supplied org.** The tenant is `ctx.activeOrganizationId`
   (server-resolved); method signatures have no `organizationId` parameter,
   so a confused-deputy cross-org call cannot be expressed. A missing org
   (platform admin included — cross-tenant access is a separate audited
   surface, ADR-0025) fails closed.
2. **No caller-supplied sender.** `postMessage`/`markThreadRead` derive the
   sender/reader FROM the session — client → linked client id, any
   staff-side role → active membership id. The input carries only
   `threadId` + `body`, so a client cannot post as staff or as another
   client, by construction.
3. **Authorize-then-act on the loaded thread.** Thread-scoped methods load
   the thread first (an RLS-scoped read under the caller's own org) and run
   `authorize()` against the thread's ACTUAL `clientId` — never a caller
   claim. `message.send`/`message.read` are client-scoped permissions, so
   the engine's ownership gate (client = own thread only) and staff
   assignment-scoping gate apply automatically; `message.close` is
   staff-side only per the policy table.

Denials throw `MessagingAccessDeniedError` carrying the engine's stable
`DenialReason` + the permission. **Uniform route-mapping rule (all seven
methods, writes included):** a denial and a not-found/unknown id MUST render
identically (404-shaped) — a 403-vs-404 or 200-empty-vs-404 split would give
same-org id probing an existence oracle (available even to pending/revoked
members, who resolve a session and fail only at the engine). Unknown/
foreign-org threads already read as null/empty; a missing thread on a write
surfaces the repository's own `ThreadNotFoundError`, which routes map to the
same 404 shape.

**Explicit deferral — sensitive-denial audit events.** The denial-reasons
contract (matrix §7 row 16) requires `not_owner` / `not_assigned` /
`membership_revoked` denials to emit audit events. No service persists
`audit_events` yet; this service throws without recording. That audit write
(or an injected audit port) MUST land with — or before — the B9 route-wiring
slice, where these denials first become reachable by real callers. Tracked
here so the requirement is not lost.

## Consequences

- **12 new tests → 171 database tests**, with a recording stub proving the
  negative space: a denied call never reaches the repository's WRITE/LIST
  surface — the only pre-authorization repository touch is the RLS-scoped
  thread load itself (org-correct, result discarded on denial); org and
  sender in every repo call come from the session; client ownership, staff
  assignment scoping, `message.close` role policy, pending-membership and
  platform-admin fail-closed, and null/empty reads for unknown ids.
- The client portal and staff messaging routes (Workstream B9) call THIS
  service, never the repository directly. The repository stays exported for
  composition, but route-layer code review treats a direct
  `MessagingRepository` call as a boundary violation.
- Same pattern queued for the other client-owned repositories as their routes
  are wired (documents, appointments, reports) — one gate service per
  repository family, engine-backed, structurally org/sender-safe.
