# @aflo/auth

Provider-neutral authentication boundary (ADR-0006: **Clerk accepted**, activation founder-gated on credentials).

## What lives here

- `AuthSession` — the server-side session contract: a `staff` or `client` identity scoped to one organization, or `null`. The browser never supplies identity.
- `AuthProvider` — the resolution interface every provider implements.
- `requireStaffSession` / `requireClientSession` — fail-closed guards; anything but the required session kind throws `UnauthorizedError`.
- `DemoAuthProvider` — fixed-persona provider for the synthetic prototype. The staff shell and the client portal each compose their own instance (a demo-only split).

Providers are **identity authorities only**. Role and membership authority stays with `organization_members` (see `docs/architecture/AUTHORIZATION_MATRIX.md`); nothing in this package grants permissions.

## Activating Clerk (founder actions required)

1. Create the Clerk application; add `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` to the Vercel project env (never the repo).
2. Add `@clerk/nextjs`, the middleware, and a `ClerkAuthProvider implements AuthProvider` here that maps the Clerk user → `organization_members` row → `AuthSession` (fail closed on missing/inactive membership; webhook sync per DATABASE_SCHEMA.md §2).
3. Swap the two demo providers in `apps/web/src/lib/data.ts` for the single Clerk-backed provider. Guards and every call site stay unchanged.

Until then the app runs on the demo personas over synthetic data.
