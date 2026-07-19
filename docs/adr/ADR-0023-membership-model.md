# ADR-0023: Membership / role-change model

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive —
the ΛFLO-owned membership record that ties invitations and Clerk membership
webhooks together)

## Context

Three pieces produced this session need a shared target: an accepted invitation
(ADR-0022) must become a real membership or client link; Clerk's
`organizationMembership.*` webhooks (ADR-0020) must reconcile into the same
record; and the session context (ADR-0019) reads a member's role + status to
authorize. Until now the `organization_members` row existed only as the session
projection type (`Membership` in identity.ts) with no lifecycle.

Membership is **authorization authority** — the role on this record decides what
a user may do — so its transitions must be deterministic and auditable, and the
"who may change a role" decision must stay with the authorization engine, not be
re-implemented here.

## Decision

Add `membership.ts` to `@aflo/auth` (pure, in the barrel):

- **`MembershipRecord`** — the stored `organization_members` row (membershipId,
  organizationId, afloUserId, memberRole, status `active|revoked|pending`,
  created/updated timestamps). Distinct from the session context's `Membership`
  (the per-request projection of it for the current user).
- **`applyAcceptedBinding(binding, { membershipId, nowIso })`** — turns an
  invitation `AcceptedBinding` into the record it implies: a staff role →
  `{ kind: "membership" }` (role mapped via `memberRoleFromRole`); a `client`
  role → `{ kind: "client_link" }` (clients are not members); an unbindable role
  (`platform_admin`/`partner_viewer`) or a client binding with no client →
  `{ kind: "rejected" }`. It trusts only the invitation-sourced binding plus the
  server-issued `membershipId`/`nowIso`.
- **`changeMemberRole` / `revokeMembership` / `reinstateMembership`** — pure
  transitions returning a discriminated `MembershipResult` with stable
  `MembershipDenial` reasons (`not_active`, `already_revoked`, `already_active`,
  `same_role`, `not_a_membership_role`, `missing_client`). Deny-by-default; the
  input record is never mutated.
- **`memberRoleFromRole`** (roles.ts) — the inverse of `roleFromMemberRole`,
  returning `null` for non-membership roles.

## Consequences

- The invitation → membership/client-link path is closed and tested (9 tests:
  staff/owner/admin bindings → membership; client binding → link; unbindable and
  missing-client rejections; role change; non-active + same-role denials;
  revoke + double-revoke; reinstate; input-immutability). Total 85 auth tests.
- **Authorization stays separate.** This model validates the STATE transition; it
  does NOT decide who may invoke it — the route must `authorize(...,
  "organization.manage_members", ...)` (owner-reserved) first.
- **Org-wide invariants are not here.** "An organization must keep at least one
  owner" needs to see all memberships — a service-layer check, not this
  single-record model. Documented so the wiring slice enforces it.
- **Not yet wired.** The webhook handler and the invitation-accept route that
  call these, and the Drizzle `organization_members` writes, are credential-gated
  (Clerk + Neon). This ADR delivers the record + transitions they consume.
