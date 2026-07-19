# ADR-0019: Authenticated session context

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive,
PHASE 2 — "Authenticated session context")

## Context

The authorization engine (ADR-0018) is a pure function over a `Principal`. For it
to run, every request must first **resolve** a principal: who authenticated, which
ΛFLO user that is, which organization and membership they are acting under, their
role and permissions, their linked client (if a client), account status, and
session id. The directive is explicit that the **browser may never
authoritatively supply** `organizationId`, `afloUserId`, `clientId`,
`membershipId`, `role`, or `permissions`, and that an unresolved identity is
rejected (fail closed).

The existing `session.ts` contract (`StaffSession`/`ClientSession` + demo
provider) is a coarse staff-vs-client split sufficient for the synthetic
prototype. It does not carry membership, role, permissions, or account status,
and cannot feed the authorization engine.

## Decision

Add a credential-free session-context layer to `@aflo/auth`:

- **`identity.ts`** — ΛFLO's own identity/membership value types (`AfloIdentity`,
  `Membership`, `ClientLink`), deliberately **not** Clerk SDK objects. Clerk owns
  authentication; ΛFLO owns organization/membership/role/client-link/account
  status. `clerkUserId` is carried only as an opaque reference. `isPlatformAdmin`
  must come only from `users.is_platform_admin`.
- **`session-context.ts`** — `SessionContext` carrying every field the directive
  lists; a server-only `SessionContextProvider` interface; `buildSessionContext`,
  the deterministic resolver both the test and (future) Clerk providers share;
  `toPrincipal` bridging to the authorization engine; and `requireSessionContext`,
  the fail-closed guard (throws `UnresolvedSessionError` on null).
- **`test-provider.ts`** — `TestSessionContextProvider`, a deterministic provider
  for tests only — explicitly **not** a runtime demo fallback.

### Resolution rules

- **Role precedence:** verified platform-admin flag → active staff membership row
  → client link. Highest-authority source wins; a user with a staff membership is
  staff even if a client link also exists.
- **A client's "active membership"** is the client link itself — clients are not
  `organization_members` rows, so the link's presence (with an active account) is
  the active tenant tie the engine's membership gate checks. Platform admin has no
  tenant tie (`activeOrganizationId = null`, `membershipStatus = "none"`); the
  engine skips the membership/tenant gates for it.
- **Unresolvable → null.** A user with no platform flag, no membership, and no
  client link resolves to `null`, which the guard rejects.

## Consequences

- The PHASE 2 → PHASE 4 path is complete and tested: build a context from
  verified records → `toPrincipal` → `authorize`. 16 session-context tests
  (role resolution, precedence, permissions-from-role, account/membership carried
  through, fail-closed guard) on top of the 34 engine tests.
- **Not yet wired into the app.** `apps/web` still uses the demo `AuthProvider`
  (`session.ts`); migrating request handlers to `SessionContextProvider` +
  `authorize` is a later slice, gated on the Clerk-backed provider
  (`clerk-provider.ts`) which needs credentials. The existing
  `StaffSession`/`ClientSession` contract is left intact so nothing breaks.
- **Server-only invariant.** `buildSessionContext` takes only verified ΛFLO
  records — there is no field through which a browser-supplied value can flow into
  role/permissions/tenant. The Clerk provider must uphold this (resolve the ΛFLO
  user and membership from the verified Clerk session server-side, never from
  request bodies or client claims), and must set `platform_admin` only from the
  verified flag (ADR-0018).
