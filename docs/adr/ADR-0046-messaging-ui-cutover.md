# ADR-0046: Messaging UI cutover — a runtime-selected data-access seam (Workstream B10)

## Status

**Accepted** — 2026-07-23 (founder continuation directive 2026-07-22,
Workstream B item 10: persistent messaging UI cutover)

## Context

PR #94 (ADR-0044) made the messaging surface route-complete: six
`/api/messages/...` handlers over the ADR-0036 `AuthorizedMessagingService`,
with the uniform anti-oracle 404, mandatory sensitive-denial audit, stable
400/409 kernel codes, and fail-closed 503/401 in the unconfigured/uncomposed
runtime. But the staff and portal messaging UI still read and wrote the demo
`AfloStore` directly (`store.conversationsFor` / `postReply` /
`markThreadRead` / `openThread` inline in pages and server actions), so no
UI path existed that could ever use the persistent surface. This slice cuts
the UI over to ONE seam that serves both runtimes without duplicating
authorization anywhere and without changing demo behavior at all.

## Decision

### 1. The seam contract lives in `@aflo/shared` (`src/messaging/ui-gateway.ts`)

Two narrow interfaces — the operations the UI actually performs, identity
NEVER a parameter:

- `StaffMessagingGateway`: `listClientConversations`, `openThread`,
  `postReply`, `markThreadRead`, `setThreadStatus` (close/reopen — exposed
  for the routes' full surface; the staff card gains no new control in this
  slice, keeping demo pixels identical).
- `PortalMessagingGateway`: `listConversations`, `sendReply(threadIndex)`,
  `markThreadRead(threadIndex)` — the portal projection stays deliberately
  id-free (`ClientThreadView`), so mutations target a thread by POSITION in
  the client's own newest-active-first list, re-resolved server-side from
  the session in BOTH implementations (a tampered index can only land inside
  the caller's own threads).

**The result vocabulary has NO denied variant** —
`MessagingUiResult<T> = ok | signed_out | not_found | rejected(code) |
unavailable`. A denial is structurally unrepresentable to the UI: it arrives
as the same `not_found` a genuinely missing thread produces (deep-equality
tested through the seam), so no rendering path can distinguish the two. The
anti-oracle rule (ADR-0036/0044) is preserved end to end; `signed_out` is
the 401 analogue (the UI's signed-out state), `rejected` carries only the
routes' stable post-authorization codes, `unavailable` is the 503 analogue.

### 2. Runtime selection reuses the EXISTING contract — no new flag

`resolveMessagingUiRuntime(env)` (same module): `"persistent"` iff
`resolveAuthMode(env) === "clerk"` AND
`resolveRepositoryMode(env) === "postgres"` (the canonical ADR-0017
resolvers), else `"demo"`. This mirrors `isMessagingRouteConfigured`
(ADR-0044) deliberately: once the REAL runtime is selected, incomplete
config (missing URLs/`FIELD_ENCRYPTION_KEY`) must surface as fail-closed
`unavailable` — NEVER a silent fallback to demo data.

### 3. Demo implementation = the store path, unchanged

`StoreStaffMessagingGateway` / `StorePortalMessagingGateway` (same module)
make byte-for-byte the `AfloStore` calls the pages/actions made before the
seam existed, with identity from the same server-resolved demo sessions.
Parity is test-pinned: the staff list equals the former inline
`conversationsFor`+`messagesForThread`+`unreadCountForStaff` composition,
and the portal list deep-equals `MockPortalRepository.getPortalView(...)
.conversations` — the demo runtime renders pixel-identically and the
existing Playwright messaging specs pass unchanged.

### 4. Persistent implementation = DIRECT invocation of the tested route services

`RouteServiceStaffMessagingGateway` / `RouteServicePortalMessagingGateway`
(`@aflo/database/src/services/messaging-ui-gateway.ts`) invoke the SAME
handler functions the six routes are thin compositions over
(`handleListThreads`, `handleGetThread`, `handleCreateThread`,
`handlePostMessage`, `handleMarkThreadRead`, `handleSetThreadStatus` —
ADR-0044), constructed from the SAME `MessagingRouteDeps` that
`composeMessagingDeps(env)` builds for the routes (`lib/messaging-runtime.ts`).

**Why direct service invocation, not a server-side fetch of the HTTP
routes:** the UI is server components + server actions in the SAME process
as the route handlers. A self-fetch would add host resolution and cookie
forwarding only to re-enter identical code, while the session still resolves
through the same `sessionProvider` closure Clerk will compose (ADR-0042) —
request-context-bound, so behavior is identical in server components,
server actions, and route handlers. Direct invocation keeps the
request/response semantics byte-derived from the tested handlers (401/uniform
404/400/409/503 → the seam vocabulary, a mechanical total mapping) with zero
duplicated authorization and no second HTTP hop. The HTTP routes remain the
surface for any future non-in-process caller.

Two composition notes:

- `openThread` = `handleCreateThread` then `handlePostMessage` (the route
  surface has no create-with-first-message operation — this is exactly the
  two calls a route-driven client makes). A failed post leaves an empty open
  thread: visible, re-postable, never partial data.
- The portal gateway resolves the session's `linkedClientId` itself
  (identity plumbing, not authorization — every subsequent call is still
  authorized by the service), projects every response through
  `toClientThreadView` server-side so the browser stays id-free exactly as
  in demo, and maps a linked-client-less session to the uniform `not_found`.

### 5. UI cutover — zero authorization logic in pages/actions

`apps/web/src/lib/messaging-client.ts` is the ONE composition point
(`staffMessaging()` / `portalMessaging()` factories selected by
`resolveMessagingUiRuntime(process.env)`). The staff client-detail page, the
portal page, and the five messaging server actions now call only the seam —
no page or action touches `store.conversationsFor`/`postReply`/... or any
repository, and none inspects why something failed: non-ok kinds render
fixed copy (`not_found` → "No secure messages found." — the SAME copy
regardless of internal cause; the words "access denied" appear nowhere), and
the compose form renders only on `ok`. In demo mode every read resolves `ok`,
so rendering is pixel-identical to the pre-seam markup. Production today:
the session source yields null → every operation `signed_out` → the cards
render the signed-out copy — inert and fail-closed until Clerk composes
(activation remains pure composition, ADR-0042).

## Consequences

- **13 new shared tests → 299** (runtime selection off the existing
  contract; store-gateway parity incl. the MockPortalRepository deep-equal,
  position-targeted portal writes, store denials mapping to the same
  `not_found`, stable rejection codes) and **15 new database tests → 345**
  (null deps → `unavailable` everywhere; postgres mode WITHOUT a session →
  `signed_out` everywhere with the service provably untouched; denial ≡
  missing deep-equality THROUGH the seam plus an Object.keys proof that the
  non-ok result carries nothing but `kind`; client-safe portal projection in
  persistent mode; kernel codes pass through). Existing Playwright messaging
  specs run unchanged in demo mode.
- The route handlers and services from #94 are untouched; route-layer code
  review continues to treat a direct `MessagingRepository` call — and now
  any direct `store.*` messaging call in `apps/web` UI code — as a boundary
  violation.
- Message bodies are never duplicated into any new store/cache: the seam
  passes repository/store values through, and portal results are the
  established client-safe projection.
- When Clerk activates, the messaging UI needs NO further change: the same
  seam serves real sessions the moment `clerkSessionSource()` composes.
  Known follow-up: swapping the REST of the portal/staff pages (dashboard
  snapshot, client detail, portal view) onto session-scoped persistent reads
  is separate cutover work — until then those cards remain demo-backed while
  messaging is runtime-selected.
