# Authenticated-Runtime Cutover Runbook

Operational runbook for switching ΛFLO (Golden Key Wealth V1) from the
demo/synthetic runtime to the real authenticated, persistent, tenant-isolated
runtime. Complements `DEPLOYMENT.md` (topology, Vercel/Railway/Neon setup).

> **Status (2026-07-20).** The **entire authenticated activation loop now exists
> and is proven credential-free in the data layer** (in-memory Postgres / PGlite,
> under real non-superuser roles). What remains is **credential-gated wiring +
> infrastructure provisioning** — no more domain logic. Nothing in this runbook
> has been applied to Neon; **Neon `main` is untouched.**

---

## 1. What is already built (credential-free, merged)

The full loop — lead → staff qualification → invite → authenticated activation →
membership/client link — is implemented and PGlite-proven end to end:

| Layer | Artifact | Proof / ADR |
|---|---|---|
| Identity schema | Migration **0005** — `identity_provider_accounts`, `invitations`, `client_user_links`, `provider_webhook_events`, `session_revocations` (digests only) | ADR-0026; `rls-auth-tables.test.ts` |
| Messaging schema | Migration **0006** — `conversation_threads`, `messages` (body ciphertext only) | ADR-0027; `rls-messaging.test.ts` |
| Resolver boundary | Migration **0007** — `find_invitation_by_token` (SECURITY DEFINER) + the two-role grant matrix | ADR-0030; `resolver-grant-matrix.test.ts` |
| Field encryption | `@aflo/security` AES-256-GCM `FieldCipher` | ADR-0028; `field-encryption.test.ts` |
| Org-scoped repos | messaging, invitations, client-user links (via `withOrgContext` + RLS) | ADR-0028/0029; `*-repository.test.ts` |
| Resolver-path repos | identity accounts, webhook events, session revocations (user-scoped) | ADR-0031; `resolver-repository.test.ts` |
| Accept orchestration | `acceptInvitationByToken` (resolve → verify → kernel → org-scoped write) | ADR-0032; `accept-invitation.test.ts` |
| Auth kernels | authorization engine, session context, invitation/membership/account, Clerk webhook verify | ADR-0018–0024 |

All are additive, forward-only, and never applied to a live DB from CI (no
`DATABASE_URL` in the CI/agent environment). GitHub is the migration authority.

---

## 2. Neon role provisioning (the compensating control ADR-0026/0030 requires)

The runtime uses **two least-privileged roles** — never the Neon owner/superuser
for app traffic. Provision them **once per Neon branch** (`dev`, then `preview`;
`main` last, only after the security baseline is signed off), via the Neon SQL
editor or a bootstrap script run by an admin — **not** committed migrations.

```sql
-- Tenant-request role: the app's per-request runtime identity. NON-BYPASSRLS, so
-- RLS (migrations 0003/0005/0006) actually constrains it.
CREATE ROLE aflo_app LOGIN PASSWORD '<generated>' NOBYPASSRLS;
GRANT USAGE ON SCHEMA public TO aflo_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aflo_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aflo_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aflo_app;

-- Resolver role: the privileged auth-resolver identity. BYPASSRLS so its
-- SECURITY DEFINER function can read invitations across orgs. LEAST PRIVILEGE:
-- provision ONLY schema usage — the role starts with NO table access. Its
-- table privileges come from the committed migrations, which are LOAD-BEARING:
--   * 0007 grants the identity/webhook/revocation tables (read/write) +
--     invitations SELECT + ownership/EXECUTE of find_invitation_by_token.
--   * 0008 grants read-only SELECT on the principal tables
--     (users, organization_members, client_user_links).
-- Do NOT add blanket `ON ALL TABLES` grants here — the resolver must never
-- hold privileges beyond what those migrations grant. No sequence grants are
-- needed: every table it writes (identity_provider_accounts,
-- provider_webhook_events, session_revocations) uses uuid gen_random_uuid()
-- defaults — there are no sequences to consume.
CREATE ROLE aflo_auth_resolver LOGIN PASSWORD '<generated>' BYPASSRLS;
GRANT USAGE ON SCHEMA public TO aflo_auth_resolver;

-- The migration-runner role MUST be a member of aflo_auth_resolver so migration
-- 0007 can reassign find_invitation_by_token's owner to it.
GRANT aflo_auth_resolver TO <migration_runner_role>;
```

Ordering matters: **provision the roles + baseline grants BEFORE applying
migration 0007** on that branch, so 0007's `REVOKE … FROM aflo_app` tightens last
(0007 is `IF EXISTS`-guarded, so it is a safe no-op if the roles are absent, but
then the wall is not applied). After 0007:

- `aflo_app` **cannot** read `identity_provider_accounts`, `provider_webhook_events`,
  `session_revocations`, nor execute `find_invitation_by_token`.
- `aflo_auth_resolver` owns the function and can read/write those three tables.

**Deploy discipline (the wall degrades silently otherwise):** do **not** re-run
`GRANT … ON ALL TABLES/FUNCTIONS … TO aflo_app` after 0007, and never grant those
tables/function to `aflo_app` through an inherited GROUP role (`REVOKE … FROM
aflo_app` cannot remove a privilege held via a parent).

The app opens **two connection pools**: the tenant pool as `aflo_app` (every
request routed through `withOrgContext`) and the resolver pool as
`aflo_auth_resolver` (identity resolution, webhook receipts, session-revocation
checks, accept-by-token). Both MUST use an **interactive-transaction driver**
(node-postgres `Pool` or `@neondatabase/serverless` WebSocket `Pool`) — the
`neon-http` driver throws on `.transaction()` and would reject every tenant
request.

---

## 3. Environment variables (per environment, dashboard-only — never the repo)

**Runtime selection first (ADR-0017 + ADR-0048).** There is no implicit runtime
anymore: every deployment either opts into the demo prototype with
`APP_ENV=demo`, or explicitly selects the real runtime with `AUTH_MODE=clerk` +
`REPOSITORY_MODE=postgres` (plus, for production, `APP_ENV=production` and the
full integration set). Anything ambiguous — including the old "no variables at
all" prototype default — refuses to boot. The cutover for each environment is
therefore: **replace `APP_ENV=demo` with the real selection below**; the two
states can never be active at once (the contract rejects the mix).

| Variable | Purpose | Notes |
|---|---|---|
| `APP_ENV` | Runtime mode | `demo` (prototype, explicit opt-in) → replaced by `preview`/`production` at cutover |
| `AUTH_MODE` | Auth provider selection | `clerk` for the real runtime; never set alongside `APP_ENV=demo` |
| `REPOSITORY_MODE` | Repository selection | `postgres` for the real runtime; never set alongside `APP_ENV=demo` |
| `DATABASE_URL` | Pooled runtime connection **as `aflo_app`** | `-pooler` host; validated fail-closed by `getDatabaseConfig` |
| `DIRECT_DATABASE_URL` | Direct connection for migrations | non-pooled host |
| `AUTH_RESOLVER_DATABASE_URL` | Pooled connection **as `aflo_auth_resolver`** | resolver pool (new — add when wiring the resolver path) |
| `FIELD_ENCRYPTION_KEY` | Base64 **32-byte** AES-256 key for message-body encryption | `parseFieldEncryptionKey` fails closed on wrong length; rotate via a key-id scheme later |
| `CLERK_SECRET_KEY` / `CLERK_PUBLISHABLE_KEY` | Clerk API keys | per-env (preview vs prod instances) |
| `CLERK_WEBHOOK_SECRET` | Svix signing secret | consumed by `@aflo/auth/webhook` `verifyWebhook` |

`FIELD_ENCRYPTION_KEY` generation (never commit the output):

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
```

Missing production/preview config must **fail closed** (stop startup) — the boot
contract (ADR-0017) already enforces this; the resolver-pool URL joins that check
when the resolver path is wired.

---

## 4. Migration apply order (GitHub is the authority)

Apply the committed migrations with the repo's `db:migrate` (Drizzle) using
`DIRECT_DATABASE_URL`, **branch by branch, never `main` first**:

1. **`dev`** → apply `0005`, `0006`, `0007` → run the verification queries below → confirm.
2. **`preview`** → apply the same → verify → confirm.
3. **`main`** → **only** after founder sign-off on the security baseline. Do **not**
   apply from CI or this session.

Provision the two roles (§2) on a branch **before** applying `0007` there.

Post-apply verification (per branch, as `aflo_app`):

```sql
SET ROLE aflo_app;
SELECT * FROM identity_provider_accounts;   -- expect: permission denied
SELECT * FROM find_invitation_by_token('x'); -- expect: permission denied
RESET ROLE;
```

---

## 5. Remaining wiring PRs (credential-gated — each needs the above)

The data layer is complete; these are the wiring slices, each blocked only on
credentials/provisioning:

1. **Connection factory + two pools.** node-postgres/Neon-serverless pools for
   `aflo_app` (→ `withOrgContext`) and `aflo_auth_resolver`; extend the boot
   fail-closed check to require both URLs + `FIELD_ENCRYPTION_KEY`.
2. **Clerk-backed session provider.** Replace the demo provider: resolve the
   Clerk session → `identity_provider_accounts` → build `SessionContext`
   (consulting `isSessionRevoked`). Then the demo-marker allowlist
   (`packages/auth/src/demo.ts`, `apps/web/src/lib/data.ts`) must **reach zero**.
3. **Clerk webhook route** `/api/webhooks/clerk`: raw body → `verifyWebhook` →
   `WebhookEventRepository.recordReceipt` (idempotent) → reconcile
   membership/identity → `markProcessed`/`markFailed`.
4. **Accept route** `/api/invitations/accept`: authenticated user →
   `acceptInvitationByToken(resolverPool, tenantPool, { rawToken, afloUserId,
   email, … })`. **The route MUST derive `afloUserId` AND `email` from the one
   verified session** (the service checks email-vs-invitation but cannot verify
   the email belongs to the user), and emit an audit/outbox event via
   `commitWithOutbox` (ADR-0032).
5. **Store → repository swap.** Route the app's messaging/CRM reads/writes onto
   the Drizzle repositories on the tenant pool.
6. **Route-level authz gating** (task #61): gate the messaging repo
   read/receipt/status methods through the authorization engine (ADR-0018
   `CLIENT_SCOPED_PERMISSIONS` + session `linkedClientId`) before the client
   portal reaches them.

---

## 6. Non-negotiables (carry into every wiring PR)

- Outside tests: **no** demo users/clients, hardcoded sessions, mock auth,
  memory-backed repositories, synthetic runtime fallback, or public
  protected-file storage. Missing prod/preview config **fails closed** — and
  since ADR-0048 the demo runtime itself is an explicit `APP_ENV=demo` opt-in:
  an ambiguous or partially configured deployment refuses to boot rather than
  landing on synthetic data (PR #97 LOW-5, closed).
- **Digests only** for tokens/session-ids/webhook payloads; **ciphertext only**
  for message bodies. Never commit secrets or real PII.
- GitHub is the migration authority; **never** hand-author Neon DDL for schema,
  and **never** apply to Neon `main` without founder sign-off.
