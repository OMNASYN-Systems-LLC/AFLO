# ADR-0032: Accept-by-token orchestration (resolver read → kernel → org-scoped write)

## Status

**Accepted** — 2026-07-20 (Production Cutover directive — the capstone tying the
resolver read to the org-scoped write)

## Context

Every piece of the authenticated activation loop now exists and is proven
credential-free: the `SECURITY DEFINER` accept-by-token lookup (ADR-0030), the
org-scoped invitation + client-link repositories (ADR-0029), the resolver-path
repositories (ADR-0031), the invitation kernel and `applyAcceptedBinding`
(ADR-0022/0023), and `withOrgContext` (ADR-0025). What was missing is the
**orchestration** that runs them in order to turn "a client clicks their invite
link" into a persisted, tenant-scoped membership or client link — a single flow
that spans a cross-org resolver read and an org-scoped write.

## Decision

`acceptInvitationByToken(resolverDb, tenantDb, input)` in
`@aflo/database/services`:

1. **Resolve across orgs, no org context.** Hash the raw token and call
   `find_invitation_by_token` (migration 0007) on the **resolver connection** —
   `invitations` is FORCE-RLS, so a plain pre-org read sees nothing; the
   SECURITY DEFINER function (owned by the BYPASSRLS resolver role) returns it.
2. **Constant-time verify** the presented raw token against the stored digest
   (`verifyInvitationToken`) — defense-in-depth over the digest match.
3. **Deterministic kernel.** `acceptInvitation` enforces email/expiry/status and
   the identity-claiming invariant (org/role/client come from the **invitation**,
   never the caller); `applyAcceptedBinding` resolves the binding to a membership
   (staff) or a client link.
4. **One `withOrgContext(resolvedOrg)` transaction** does the org-scoped writes
   atomically: it **CLAIMS** the invitation with a conditional
   `UPDATE … WHERE id = … AND status = 'pending' RETURNING` (a concurrent accept
   that won the race leaves zero rows → the tx throws `InvitationClaimConflict`
   and rolls back, surfaced as `already_accepted`), then inserts the
   `client_user_link` or `organization_members` row. Both commit together or not
   at all.

The org is discovered *from the invitation*, so the write is correctly
tenant-scoped even though the resolve preceded any org context. The two DB
handles are distinct in production (`aflo_auth_resolver` for the resolve,
`aflo_app` under `withOrgContext` for the write); a single handle in tests.

`@aflo/database` importing `@aflo/auth/invitation-token` (node:crypto) is safe —
`@aflo/database` is a server/worker package, never bundled to the client (the web
build stays green).

## Consequences

- **Proven credential-free on PGlite** (`accept-invitation.test.ts`, 6 tests):
  staff accept → `organization_members` row (`staff_advisor` → member role
  `staff`) + invitation `accepted`; client accept → active `client_user_link` +
  invitation `accepted`; and the rejection paths — invalid/unknown token,
  email mismatch (invitation left `pending`), expired, and re-accepting an
  already-accepted invitation. **158 database tests total**; workspace
  typecheck/lint + web build + demo-guard green.
- **Not yet wired.** The HTTP accept route (authenticated user → this service
  with the two role-scoped connections) is credential-gated (Clerk session +
  the two Neon roles). The service is the credential-free, tested core it will
  call.
- **The authenticated activation loop is now complete end-to-end in the data
  layer** — lead → invite issue (ADR-0029) → durable invitation (0005) →
  accept-by-token resolve (0030) → kernel accept → org-scoped membership/link
  write (this ADR). What remains is credential-gated wiring (the Clerk-backed
  provider, the webhook + accept routes, the two Neon role connections) and the
  route-level authz gating already tracked (messaging authz, task #61).
