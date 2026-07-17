# Deployment and Environment Notes

Operational reference for deploying AFLO (Golden Key Wealth V1) across Vercel, Railway, Neon, and object storage.

> **Current status (2026-07):** Nothing in this document has been provisioned. There are no Vercel projects, Railway services, Neon databases, storage buckets, or DNS records yet. This file records the intended topology so provisioning is deliberate and reviewable when it happens. The first visual slice runs entirely on mock repositories and requires **zero environment variables** (see below).

---

## 1. Environment Topology

Three environments, isolated end to end. No environment shares a database, a secret, or a storage bucket with another.

| Environment | Vercel (apps/web) | Railway (apps/worker) | Neon (PostgreSQL) | Object storage | Data policy |
|---|---|---|---|---|---|
| **Development** | Local `pnpm dev` | Local process | Neon branch `dev` (or per-developer branch) | Local stub / dev bucket | Synthetic only |
| **Preview** | Auto-deploy per PR | Optional shared `preview` service | Neon branch per PR or shared `preview` branch | Dev/preview bucket | Synthetic only |
| **Production** | `main` branch deploys | Railway `production` service | Neon `main` branch | Production bucket | Pilot data only after security baseline is met |

Neon branching notes:

- The Neon **`main` branch is production**. It is never used for development or preview work.
- Preview environments should use Neon's branch-per-PR integration (or a single shared `preview` branch early on). Branches are cheap copies; delete them when the PR closes.
- Connection strings differ per branch. Each Vercel/Railway environment gets its own `DATABASE_URL`; never point a preview deployment at the `main` branch.
- Use the **pooled** connection string (`-pooler` host) for the app at runtime and the **direct** connection string for migrations (`DIRECT_DATABASE_URL`).

---

## 2. Vercel — `apps/web`

The repo is a pnpm workspace monorepo. Vercel must build from the workspace root but target the web app.

| Setting | Value |
|---|---|
| Framework preset | Next.js |
| Root directory | `apps/web` |
| Include files outside root directory | Enabled (required for workspace packages) |
| Install command | default (`pnpm install`) — Vercel detects pnpm from the lockfile |
| Build command | default (`next build`) |
| Node.js version | 22.x (matches `engines.node >=22` in root `package.json`) |
| Production branch | `main` |

pnpm version pinning:

- The root `package.json` declares `"packageManager": "pnpm@10.33.0"`. Vercel reads this field (Corepack) and uses the exact pinned version. Do not override the pnpm version in project settings; update the `packageManager` field instead so local, CI, and Vercel stay in lockstep.
- `pnpm-lock.yaml` must be committed and current; a lockfile/manifest mismatch fails the build.

Workspace packages:

- Internal packages (`@aflo/shared`, later `@aflo/ui`, `@aflo/rules`, `@aflo/database`, ...) are consumed as TypeScript source and transpiled by Next.js. List them in `transpilePackages` in `apps/web/next.config.ts`:

```ts
// apps/web/next.config.ts
const nextConfig = {
  transpilePackages: ["@aflo/shared", "@aflo/ui", "@aflo/rules"],
};
export default nextConfig;
```

- This avoids per-package build steps in V1. If a package later ships compiled output, remove it from `transpilePackages` and add a `build` script that Turborepo/`pnpm -r build` runs first.

Preview deployments:

- Every PR gets a preview URL automatically. Previews must use preview-scoped env vars (Vercel environments: Development / Preview / Production) and a non-production Neon branch.
- Preview deployments render synthetic data only.

---

## 3. Railway — `apps/worker`

One Railway service running the background worker: outbox polling, scheduled reminders, quarterly report generation, notification queues, AI job execution.

| Setting | Value |
|---|---|
| Source | GitHub repo, branch `main` (production) |
| Root directory | `/` (workspace root, so pnpm can resolve workspace deps) |
| Build command | `pnpm install --frozen-lockfile && pnpm --filter @aflo/worker build` |
| Start command | `pnpm --filter @aflo/worker start` |
| Restart policy | On failure, capped retries (e.g. max 10) — the worker should also exit non-zero on unrecoverable errors so Railway restarts it |
| Health | Worker logs a heartbeat; alerting via Sentry, not Railway health checks, in V1 |

Scheduling:

- Two acceptable patterns; pick one per job class and document it in the worker README:
  1. **Long-running worker loop** (default for V1): the service stays up, polls the outbox table, and runs an internal scheduler (e.g. `node-cron`) for time-based jobs such as daily reminders and quarterly report kickoffs. Simplest; one service.
  2. **Railway cron jobs**: a service configured with a cron schedule (`Cron Schedule` in service settings, standard 5-field cron, UTC) that starts, runs one pass, and exits. Use later if job isolation is needed.
- All jobs must be **idempotent** — Railway restarts, redeploys, and overlapping runs are expected. Job results and failures are recorded (outbox row state + audit events), never silently dropped.
- Dead-letter handling: after N failed attempts a job moves to a dead-letter state and surfaces in Sentry; it is never retried forever.

---

## 4. Neon — PostgreSQL

- One Neon project; branches per environment as described in §1.
- Runtime connections go through the pooled endpoint (`DATABASE_URL`); migrations and anything requiring session-level features (advisory locks, `LISTEN/NOTIFY`) use the direct endpoint (`DIRECT_DATABASE_URL`).
- `sslmode=require` on all connection strings.
- Roles: use a least-privilege application role for the web/worker runtime once RLS or repository-level scoping is in place; the Neon default owner role is for migrations only. (Deferred until the first Neon-backed slice; recorded here so it is not forgotten.)

---

## 5. Object Storage

Vercel Blob (default) or any S3-compatible store (Cloudflare R2, AWS S3).

- One bucket/store **per environment**; never share production and preview storage.
- Documents are private by default; access is only via short-lived signed URLs issued by the app after an authorization check.
- The web app authorizes uploads; the worker handles long-running document processing.
- No real client documents until the security baseline (encryption, audit, isolation checks) is verified. Synthetic PDFs only during development.

---

## 6. Environment Variables Registry

All values below are **placeholders**. Real values live only in the Vercel and Railway dashboards (see §8).

**The first visual slice requires no environment variables.** It uses in-memory mock repositories, no auth provider, and makes no external calls. Every variable below is introduced only when the feature that needs it lands; "Required when" states that trigger.

| Name | Service | Required when | Description | Example placeholder |
|---|---|---|---|---|
| `DATABASE_URL` | both | First Neon-backed repository ships | Pooled Neon connection string for runtime queries | `postgresql://app_user:<password>@ep-example-123-pooler.us-east-2.aws.neon.tech/aflo?sslmode=require` |
| `DIRECT_DATABASE_URL` | both (CI + worker) | Migrations run against Neon | Direct (non-pooled) Neon connection string for migrations and session-level features | `postgresql://app_owner:<password>@ep-example-123.us-east-2.aws.neon.tech/aflo?sslmode=require` |
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | web | Clerk chosen and auth slice ships | Clerk publishable key (client-safe) | `pk_test_xxxxxxxxxxxx` |
| `CLERK_SECRET_KEY` | web | Clerk chosen and auth slice ships | Clerk server secret | `sk_test_xxxxxxxxxxxx` |
| `AUTH_SECRET` | web | Auth.js chosen instead of Clerk | Auth.js session encryption secret (generate with `openssl rand -base64 32`) | `<random-32-byte-base64>` |
| `AUTH_URL` | web | Auth.js chosen instead of Clerk | Canonical auth callback base URL | `https://app.example.com` |
| `BLOB_READ_WRITE_TOKEN` | both | Document upload/storage ships on Vercel Blob | Vercel Blob read-write token | `vercel_blob_rw_xxxxxxxxxxxx` |
| `S3_ENDPOINT` | both | S3-compatible storage chosen instead of Vercel Blob | S3 API endpoint | `https://<account-id>.r2.cloudflarestorage.com` |
| `S3_BUCKET` | both | S3-compatible storage chosen | Bucket name for this environment | `aflo-documents-preview` |
| `S3_ACCESS_KEY_ID` | both | S3-compatible storage chosen | Access key ID for a least-privilege service account | `AKIAEXAMPLEKEYID` |
| `S3_SECRET_ACCESS_KEY` | both | S3-compatible storage chosen | Secret access key | `<secret-access-key>` |
| `RESEND_API_KEY` | worker (and web if it sends transactional mail) | Email notifications ship | Resend API key | `re_xxxxxxxxxxxx` |
| `NEXT_PUBLIC_POSTHOG_KEY` | web | Product analytics ship | PostHog project API key (client-safe) | `phc_xxxxxxxxxxxx` |
| `NEXT_PUBLIC_POSTHOG_HOST` | web | Product analytics ship | PostHog ingestion host | `https://us.i.posthog.com` |
| `SENTRY_DSN` | both | Error monitoring ships | Sentry DSN for this service/environment | `https://<key>@o000000.ingest.sentry.io/0000000` |
| `AI_PROVIDER` | both | Any AI agent runs against a real model | Selects the provider behind the internal AI interface: `anthropic`, `openai`, or `mock` | `mock` |
| `ANTHROPIC_API_KEY` | both | `AI_PROVIDER=anthropic` | Anthropic API key | `sk-ant-xxxxxxxxxxxx` |
| `OPENAI_API_KEY` | both | `AI_PROVIDER=openai` | OpenAI API key | `sk-proj-xxxxxxxxxxxx` |
| `APP_BASE_URL` | both | Emails/links/redirects reference absolute URLs | Canonical base URL of the web app for this environment | `https://app.example.com` (prod) / `http://localhost:3000` (dev) |

Conventions:

- `NEXT_PUBLIC_*` variables are compiled into the client bundle — never put secrets behind that prefix.
- Validate env vars at startup with a typed schema (e.g. Zod in `packages/shared`) so a misconfigured deployment fails fast instead of failing mid-request.
- `AI_PROVIDER=mock` must remain a supported value forever, so tests and previews never require a real model key.
- Maintain `.env.example` files (placeholders only) in `apps/web` and `apps/worker` mirroring this table; update this registry and the examples in the same PR that introduces a variable.

---

## 7. Database Migrations

- Migrations are plain, ordered SQL files in `packages/database/migrations/` (e.g. `0001_init.sql`, `0002_add_audit_events.sql`), applied by a small runner in `packages/database` that records applied migrations in a `schema_migrations` table.
- **CI applies migrations to non-production Neon branches only:** a CI step runs pending migrations against the PR's Neon preview branch (or the shared `preview` branch) using `DIRECT_DATABASE_URL`, so schema changes are exercised before merge.
- **Production migrations are never auto-applied.** Applying migrations to the Neon `main` branch is a manually triggered, reviewed step (manual CI workflow dispatch or a documented runbook command) executed after PR review and merge. No deploy pipeline runs prod migrations as a side effect.
- Migrations must be forward-only and reviewed like code. Destructive changes (drops, type narrowing) require an explicit rollback note in the PR description.
- Every migration that touches tenant-owned tables must preserve the `organization_id` isolation invariant; reviewers check this explicitly.

---

## 8. Secrets Policy

- Secrets are managed **only** in the Vercel and Railway dashboards (per-environment scoping) and, for CI-only secrets such as the migration `DIRECT_DATABASE_URL`, in GitHub Actions repository secrets.
- Never commit secrets, `.env` files with real values, connection strings, API keys, or credentials to the repository — including in docs, tests, fixtures, issues, or PR descriptions. Only `.env.example` files with placeholders are committed.
- Per CLAUDE.md: no production PII, credit reports, SSNs, bank records, or credentials anywhere in the repo, ever.
- Development, preview, and production use **different** secret values for every variable. Rotating one environment must not affect another.
- If a secret is ever committed, treat it as compromised: rotate it immediately, then scrub history.
- Prefer least-privilege keys (restricted Resend sending domains, scoped storage tokens, DB roles with minimal grants).

---

## 9. Provisioning Checklist (when the time comes)

1. Create the Neon project; confirm `main` is reserved for production and create the `dev`/`preview` branches.
2. Create the Vercel project with root directory `apps/web`; verify pnpm 10.33.0 is picked up from `packageManager`.
3. Create the Railway service with the build/start commands in §3; set restart policy.
4. Create per-environment storage (Vercel Blob store or bucket) with private access.
5. Enter environment variables per §6, scoped per environment.
6. Wire the CI migration step against the preview Neon branch (§7).
7. Confirm a preview deployment renders the synthetic dashboard with no production resources reachable.
8. Record any deviations from this document in an ADR under `docs/architecture/`.
