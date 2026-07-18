# ADR-0006: Authentication Provider — Clerk

## Status

**Accepted** — 2026-07-18 (founder approved Clerk for V1; originally Proposed 2026-07-17)

The charter permits "Clerk or Auth.js after documenting security and multi-tenant implications." This ADR documents those implications. **Founder decision (2026-07-18): Clerk is approved for V1**, implemented behind a provider adapter in `packages/auth` so the Auth.js fallback remains a contained swap. Production Clerk credentials are prepared but not activated until supplied via provider dashboards.

## Context

Sprint 3 introduces real authentication. The schema already anticipates it: `users.auth_provider_id` maps a global user to the provider's subject, sessions are owned by the provider (no custom `sessions` table), and all tenant authorization is evaluated per `organization_members` row — never per user alone (`docs/architecture/AUTHORIZATION_MATRIX.md`).

Charter constraints that bind either choice:

- Never store passwords directly; never invent custom authentication cryptography.
- Enforce authorization server-side; organization-level and user-level isolation on every request.
- RLS session variables (`app.current_org_id` / `app.current_user_id`) are the database-level tenancy backstop and must only ever be set from trusted, server-verified values.

The structural risk to avoid: letting the identity vendor's "organizations" feature quietly become the authorization system, so that a vendor misconfiguration, stale token, or webhook lag grants tenant access the database would deny.

## Decision (Recommendation)

Recommend **Clerk** as the authentication provider, with **Auth.js as the documented fallback**, under invariants that hold regardless of which is chosen:

- **Identity authority vs authorization authority.** The provider answers only *who is this?* The Neon `organization_members` table remains the sole authorization authority for *what may they do, in which organization?* Provider organization/role features are not used as an access-control source.
- **Every request re-validates membership server-side.** After verifying the session, the server loads the user's `organization_members` row and evaluates the role per AUTHORIZATION_MATRIX.md. JWT/session claims about organization or role are routing hints only — never trusted without the membership lookup.
- **RLS variables from verified state only.** `app.current_org_id` and `app.current_user_id` are set at transaction start exclusively from the server-verified identity plus the membership lookup — never from client-supplied claims, headers, or URL parameters.
- **Credentials live with the provider.** Passwords, MFA, session tokens, and recovery flows are handled entirely by Clerk (or Auth.js's OAuth/passwordless flows). AFLO stores no password hashes and implements no auth cryptography, per the charter.
- **Vendor isolation in `packages/auth`.** All provider touchpoints (session verification, user resolution, webhook handling, sign-in UI wiring) go through a small adapter in `packages/auth` exposing a provider-neutral interface (`getVerifiedUser()`, `requireMembership(orgId)`), so switching to Auth.js is a contained change, not a codebase-wide edit.
- **Webhook sync fails closed.** Clerk webhooks (signature-verified) sync user lifecycle events into `users` (`auth_provider_id`). If sync is stale or a webhook is missed: an authenticated identity with no matching `users`/`organization_members` rows gets **no** tenant access — nothing is auto-provisioned; deactivation is mirrored in our tables (`users.is_active`) so revocation does not depend on webhook delivery to take effect locally; a periodic reconciliation job detects drift. Absence of data always means denial.

## Consequences

Positive:

- Sign-in, MFA, session management, and account recovery are production-grade on day one, with none of that attack surface in our code.
- The membership-authority model means the security-critical path (membership lookup → RLS context) is identical under Clerk, Auth.js, or any future provider — the vendor choice cannot weaken tenancy.
- Clerk's prebuilt Next.js App Router components shorten Sprint 3 and fit the "smallest complete slice" delivery rule.

Negative / accepted costs:

- Vendor dependency: per-MAU cost at scale, identity data residing with a third party (a residency/consent consideration to document before pilot), and exposure to vendor outages for sign-in (not for authorization, which stays local).
- Webhook-based sync adds an eventual-consistency seam that must be tested (the fail-closed behavior above is a CI-testable requirement, alongside the RLS isolation suite).
- Two sources of user truth (Clerk + `users`) require the reconciliation job and clear ownership rules: Clerk owns credentials/profile basics; Neon owns everything authorization-relevant.

Auth.js trade-offs (the fallback):

- We own the session and credential surface: adapter tables, token rotation, CSRF handling, and any credential-based flow — more security-critical code to write, review, and maintain, which cuts against "never invent auth cryptography" in spirit even when using its primitives correctly.
- No vendor cost or data-residency concerns; identity data stays in Neon; no webhook seam (the adapter writes directly to our tables).
- Chosen only if founder review rejects Clerk's cost/residency profile; the `packages/auth` adapter and every invariant above carry over unchanged.

## Alternatives Considered

1. **Auth.js as the primary choice.** Viable and fully self-hosted, but shifts session/credential responsibility onto a very small team during the same sprint that introduces migrations, RLS, and audit events. Kept as the documented fallback rather than rejected.
2. **Custom email/password authentication.** Rejected outright: the charter forbids storing passwords and inventing authentication cryptography.
3. **Using the provider's organization/role features as the authorization system.** Rejected: authorization must live in `organization_members` under our audit and RLS controls; vendor org state can lag, be misconfigured, or diverge from the database that RLS actually enforces.
