# ADR-0022: Invitation state machine

## Status

**Accepted** — 2026-07-19 (Auth/Authz/Production-Runtime Conversion directive,
PHASE 5 — "Invitations")

## Context

Onboarding both sides of the pilot goes through invitations: an owner/admin
invites staff; staff activate a client. The directive names a hard security
invariant — **"one Clerk identity cannot claim another client record"** — and a
lifecycle: issue → accept, plus revoke and expire. This is ΛFLO-owned state
(Clerk sends the email / creates the Clerk invite; ΛFLO decides who may accept
what), so it is pure and testable now, before the Clerk API is wired.

## Decision

Add the invitation model to `@aflo/auth`:

- **`invitation.ts`** (pure, in the barrel) — the `Invitation` record and the
  deterministic transitions `issueInvitation`, `acceptInvitation`,
  `revokeInvitation`, `expireInvitation`, returning a discriminated
  `InvitationResult` with stable `InvitationDenial` reason codes
  (`already_accepted/revoked/expired`, `expired`, `not_expired`, `email_mismatch`,
  `org_mismatch`, `client_mismatch`). `nowIso` is injected for deterministic
  tests; expiry parsing fails closed (an unparseable timestamp is treated as
  expired).
- **`invitation-token.ts`** (`@aflo/auth/invitation-token` subpath, server-only,
  `node:crypto`) — `generateInvitationToken` (random token + its hash),
  `hashInvitationToken`, and constant-time `verifyInvitationToken`. Only the
  **hash** is stored on the invitation; the raw token lives only in the invite
  link. Crypto is kept off the barrel, like `@aflo/auth/webhook`.

### The identity-claiming invariant

- A **client** invitation MUST reserve a specific client (`reservedClientId`); a
  **staff** invitation MUST NOT (`issueInvitation` throws otherwise).
- `acceptInvitation` sources the resulting `AcceptedBinding` (organization, role,
  client) **from the invitation** — never from the accepting request. If the
  acceptance flow echoes a `claimedOrganizationId`/`claimedClientId`, it must
  equal the invitation's values or the accept is rejected (`org_mismatch` /
  `client_mismatch`). So an authenticated user can only ever be bound to the
  client/org it was invited to; the browser cannot substitute a different id.
- Acceptance also requires the accepting identity's **verified** email to match
  the invitation (`email_mismatch`).

## Consequences

- The invitation lifecycle + the claiming invariant are complete and tested
  (12 tests: normalize/issue invariants, valid accept + binding-from-invitation,
  client/org substitution rejected, email mismatch, expiry, double-accept,
  revoke/expire transitions, token generate/hash/verify).
- **Not yet wired.** The route/flow that sends the Clerk invitation, persists the
  invitation (Drizzle `invitations` table), reads the raw token from the accept
  link, verifies it, calls `acceptInvitation`, and applies the binding (creating
  the membership / linking the client) is a later slice — credential-gated on
  Clerk + the DB. This ADR delivers the rules + token primitives it will use.
- The verified email must come from Clerk (the identity provider), never a form
  field — documented for the wiring slice.
