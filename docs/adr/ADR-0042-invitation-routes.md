# ADR-0042: Invitation issuance + acceptance routes (Workstream B6/B7)

## Status

**Accepted** — 2026-07-23 (founder continuation directive 2026-07-22,
Workstream B items 6/7)

## Context

Every layer of the invitation flow existed unwired: the pure state-machine
kernel (`issueInvitation`/`acceptInvitation`, ADR-0022), the server-only token
subpath (`@aflo/auth/invitation-token` — raw token high-entropy, digest-only
storage), the org-scoped `DrizzleInvitationRepository` (ADR-0029), the
PGlite-proven `acceptInvitationByToken` orchestration (ADR-0032), the
provider-backed session adapter (ADR-0035) and its Drizzle principal directory
(ADR-0037). What was missing were the HTTP routes — and they must land
credential-free, in the B4 pattern (ADR-0039): a tested service in
`@aflo/database/services` with fully injected deps, plus a thin fail-closed
Next.js route composing it from env.

## Decision

**`handleIssueInvitation(deps, input)` / `handleAcceptInvitation(deps, input)`**
(`@aflo/database/src/services/invitation-routes.ts`) — the tested cores. Deps
are injected (session provider, invitation repository / pre-bound
`acceptInvitationByToken`, clock, id + token-pair generators, verified-email
accessor), so tests drive them with stubs + PGlite and the routes only compose.
The security contract:

1. **Raw-token-once (issuance).** The raw invitation token appears exactly
   once — in the 201 body of the issuing call. Only the sha256 digest is
   persisted (the domain type cannot even represent the raw token); it is
   never logged and can never be retrieved again. The `generateToken` dep is
   injected so the test pins a deterministic pair and dumps the row to prove
   digest-only persistence.
2. **Owner-only issuance via the engine.** `authorize(toPrincipal(ctx),
   "organization.manage_members", { organizationId: ctx.activeOrganizationId })`.
   There is no invitation-specific permission token; per
   AUTHORIZATION_MATRIX §4 footnote b, managing memberships/**invitations** is
   the owner-reserved capability that `organization.manage_members` names, so
   that permission gates issuance — Organization Admin, Staff, Client, and
   Partner are all denied by the policy map (documented choice, no new token
   minted). The issuing org is always the SESSION's active org, never request
   input; a principal with no active org — platform admin included, whose
   invitation surface is the separate audited platform plane — fails closed
   (403 `no_active_membership`) before the engine runs. Input is validated
   only AFTER authorization; kernel invariants (invitable roles only; a client
   invitation MUST reserve a client, any other role MUST NOT) surface as
   stable 400 reason codes; a reserved client outside the org (RLS-invisible)
   is 400 `client_not_in_organization`; the one-pending-per-(org,email) index
   is 409 `duplicate_pending_invitation`.
3. **Session-verified email (acceptance).** `SessionContext` carries no email,
   so the accept service takes an injected `verifiedEmail(ctx)` accessor that
   the composition root binds to the VERIFIED Clerk session identity
   (provider-verified primary email) — never the request body. No verified
   email → 401 fail closed. The accepter must already hold a resolved session
   (401 otherwise); org/role/client then bind FROM the invitation
   (identity-claiming invariant, ADR-0022/0032).
4. **Oracle-uniform not-found (acceptance).** `invalid_token` and
   `email_mismatch` return byte-identical 404 `invitation_not_found`
   responses: an email-mismatch denial would confirm to the wrong holder of a
   leaked/forwarded link that the token is live and worth phishing the right
   inbox for (test-asserted with a deep-equality check). Post-terminal states
   keep distinct stable codes — `expired`/`already_expired`/`already_revoked`
   → 410, `already_accepted`/`already_bound` → 409 — because those
   invitations can no longer be claimed by anyone (no comparable oracle
   value) and real invitees need the distinction to act. Unknown denials
   default to 409, never 200 and never a leak.

**`POST /api/invitations`** and **`POST /api/invitations/accept`**
(`apps/web/src/app/api/invitations/{route.ts,accept/route.ts}`) — thin
compositions. Both fail closed 503 `not_configured` unless `AUTH_MODE=clerk`,
`REPOSITORY_MODE=postgres`, `DATABASE_URL` (tenant role — org-scoped writes)
and `AUTH_RESOLVER_DATABASE_URL` (resolver role — principal resolution +
accept-by-token lookup) are all present; the demo/synthetic runtime never
mints or claims real invitations. Responses are `no-store` (the issue body
carries the raw token). `runtime = "nodejs"`, `dynamic = "force-dynamic"`.

**`apps/web/src/lib/auth-runtime.ts`** — the tiny server-only helper extracted
from the B4 route pattern: module-scoped lazy URL-keyed connection caches for
BOTH role-scoped pools (a replaced handle is drained, not leaked), plus the
session seam: `ProviderSessionContextProvider` over the Drizzle principal
directory and a digest-only revocation gate. `clerkSessionSource()` and
`verifiedSessionEmail()` are the ONLY credential-gated points — today they
yield null, so both routes answer 401 to every request (fail closed, no stub
identities). **Activation is composition, not new logic**: swap in the Clerk
`auth()` closure documented in `@aflo/auth/provider-session.ts`, bind the
verified primary email, set the env — nothing downstream changes.

## Explicit deferral — matrix §7 audit emission (MUST ship with Clerk activation)

AUTHORIZATION_MATRIX §7 row 1 requires an audit event for membership
creation, including invitations issued and accepted; ADR-0032 deferred that
emission to this route layer, and this slice defers it ONCE more — to the
Clerk-activation PR — for one reason only: these routes are provably INERT
in production today (`clerkSessionSource()` yields null, so every request
401s and no unaudited state change is reachable). The activation PR that
supplies the Clerk closure MUST, in the same change, add the audit/outbox
emission for `invitation.issued` and `invitation.accepted` (digests and ids
only, never the raw token). This paragraph is the tracked obligation.

## Consequences

- **18 new tests → 273 database tests** (`invitation-routes.test.ts`, PGlite,
  non-superuser role so RLS is real): 401 issue/accept unauthenticated;
  client-role and org-admin 403; platform-admin 403 `no_active_membership`;
  owner client-invite 201 with raw token returned + full row dump proving
  digest-only persistence (raw token appears nowhere) and session-org/audit
  fields; duplicate-pending 409; kernel 400s (`invalid_client_invitation`
  both directions, `role_not_invitable`, `invalid_role`, `invalid_email`);
  foreign-org reserved client 400; accept happy paths (staff → membership,
  client → reserved-client link); `no_verified_email` 401 leaving the
  invitation pending; double-accept 409; and the anti-oracle deep-equality
  proof for invalid-token vs email-mismatch.
- The webhook route's private connection cache is left untouched (a merged,
  tested surface); its pattern is what `auth-runtime.ts` generalizes. The two
  caches can hold separate resolver pools — acceptable (pools are lazy, max 10)
  and worth unifying only when a third route needs it.
- Known gap, stated: a FIRST-TIME invitee has no `users` row / identity
  mapping yet, so the current session provider resolves null and acceptance
  answers 401. Provisioning the ΛFLO user at first verified sign-in (the
  identity-claiming handshake that creates `users` + `identity_provider_accounts`
  before accept) is the next credential-gated slice; the fail-closed 401 is
  the correct baseline until then, and the accept service needs no change —
  only the composition root's session provider grows.
- Credential-gated remainder: the Clerk closure + verified-email binding in
  `auth-runtime.ts` and the env (`AUTH_MODE`, `REPOSITORY_MODE`, the two
  database URLs, Clerk keys). No new logic.
