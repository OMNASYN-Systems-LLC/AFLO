# ADR-0018: Deterministic authorization engine

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive,
PHASE 4 — "Roles and permissions")

## Context

The founder's conversion directive requires that **every protected server action
and route evaluate an explicit permission** — not a role name — over the full
request context: authenticated identity, active membership, tenant, permission,
ownership, staff assignment, consent, and record state, returning **stable
denial reason codes** and auditing sensitive denials.

Until now authorization was implicit: the UI gated by session kind (staff vs.
client, `packages/auth/session.ts`), and repository/store code assumed a single
trusted tenant. There was no central, testable policy that a wiring layer could
call, and no vocabulary of permissions or denial reasons. The
`AUTHORIZATION_MATRIX.md` described the intended policy in prose and tables but
had no executable form.

This is the credential-free foundation of the auth phase: it can be built and
exhaustively unit-tested now, with no dependency on Clerk or Neon, so that when
identity resolution (session context) and persistence land, the policy they call
is already proven.

## Decision

Add a pure, deterministic authorization core to `@aflo/auth`:

- **`roles.ts`** — the six-role authorization vocabulary (`platform_admin`,
  `organization_owner`, `organization_admin`, `staff_advisor`, `client`,
  `partner_viewer`), kept **distinct** from the domain membership role
  (`MemberRole` = owner/admin/staff). A principal's authorization role is
  resolved per request from several signals — a membership row, the platform
  flag on `users`, or a client-account link — not one column. `roleFromMemberRole`
  bridges the three org-staff roles.
- **`permissions.ts`** — the explicit `resource.action` permission union from the
  directive (34 permissions across leads, clients, intake, roadmaps, tasks,
  documents, appointments, messaging, reports, billing, organization, audit).
- **`policies.ts`** — the role→permission map, derived from
  `AUTHORIZATION_MATRIX.md §4`. Deny-by-default. Owner holds all; Admin is Owner
  minus `organization.manage_members`; Staff holds the operational set (no
  billing, no member management, no `audit.read`, no `client.assign`); Client
  holds only self-service permissions (enforced against OWN records); Platform
  Admin holds a **read-only** cross-tenant subset plus `audit.read` and never a
  tenant approval/mutation permission; Partner Viewer is reserved with none.
- **`denial-reasons.ts`** — the stable denial-code contract, plus the set of
  **sensitive** denials (cross-tenant, ownership, assignment, revoked, disabled)
  that MUST emit an audit event (matrix §7 row 16).
- **`authorization.ts`** — `authorize(request): { allowed, reason }`, a pure
  function evaluating the gates in fixed order (authenticated → account enabled →
  membership active → same tenant → role holds permission → ownership →
  assignment → consent → record state). Fails closed: the first failing gate
  wins and anything unproven is denied. `assertAuthorized` throws
  `AuthorizationError` carrying the reason for call sites that prefer it.

## Consequences

- The matrix now has an executable, tested twin (30 auth tests, incl.
  cross-tenant, IDOR/ownership, unassigned-staff, revoked-membership,
  disabled-account, deny-by-default, and platform-admin read-vs-mutate cases).
- **Not yet wired.** `authorize()` is not yet called by server actions or routes
  — that is the follow-up once the session context (PHASE 2) resolves a real
  `Principal`. This ADR delivers the policy; the enforcement layer consumes it.
- Staff **assignment scoping** is implemented but opt-in: a non-null
  `assignedClientIds` activates it; `null` preserves the matrix's current
  "staff see all clients in their org" default (open item §8).
- **Record-state** and **consent** are generic gates on the request, so domain
  workflows can pass their own state/consent facts without the engine knowing
  each workflow's states.
- The permission set is the tenant-operation vocabulary. Platform-management
  powers (org provisioning, rule-version publishing) live on a separate platform
  surface, not in these tokens — noted so a future reader does not expect
  `platform_admin` to mutate through this map.

## Post-review hardening

An adversarial security review of the first cut found a fail-open in the
ownership gate; the following are folded in before this ADR is considered done:

- **Client-scoped vs org-scoped permissions (the fix).** Each permission is now
  classified: `CLIENT_SCOPED_PERMISSIONS` (client/intake/roadmap/task/document/
  appointment/message/report — the resource carries a `clientId`) vs org-scoped
  (leads, billing, `organization.*`, `audit.read`). For a client-scoped
  permission the ownership gate (client) and the assignment gate (staff) require
  `resource.clientId` to be **present and matching** — a missing `clientId` now
  fails **closed** (`not_owner` / `not_assigned`), not open. Org-scoped
  permissions are unaffected so org-level actions with no `clientId` still work.
  This is the layer-2 half of matrix §6 "no layer trusts the one above it."
- **Policy map is copy-on-read + fail-closed lookup.** `permissionsForRole`
  returns a fresh `Set` (a `ReadonlySet` is only a compile-time promise), so a
  caller cannot poison the process-wide map by reference; `roleHasPermission`
  returns `false` for an unknown role instead of throwing.
- **Matrix fidelity.** `AUTHORIZATION_MATRIX §4` gained explicit **Secure
  messaging** and **Billing** rows (footnotes †, ‡) so every one of the 34
  permissions is traceable to the source-of-truth matrix.

## Contracts the wiring layer (PHASE 2) MUST honor

`authorize()` trusts the resolved `Principal` — that trust is only sound if the
session-context resolver enforces:

- **`role: "platform_admin"` may be set ONLY from the verified
  `users.is_platform_admin` flag** — never from a Clerk claim, session value, or
  anything client-influenced. Platform admin skips the membership + tenant gates,
  so a spoofable source here would be a cross-tenant bypass.
- **Every platform-admin cross-tenant access (read included) must emit an audit
  event** (matrix §7 row 2). The decision object does not carry an audit signal;
  the enforcement layer infers it from `role === "platform_admin"` and a
  tenant mismatch and must not forget it.
- The resolver populates `resource.clientId` for every client-owned resource;
  the engine now fails closed if it is omitted, but correctness still wants it
  populated so legitimate access is not denied.
