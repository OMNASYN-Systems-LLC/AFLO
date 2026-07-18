# AFLO Build Status

Living status of the AFLO V1 build. Updated every implementation cycle. Newest state at top of each list.

_Last updated: 2026-07-18 · branch `claude/new-session-dv6ka5` → merging to `main`._

## Legend

`✅ done` · `🔨 in progress` · `⏭ next` · `⛔ blocked` · `🕓 deferred` · `🔒 security review required` · `👤 founder decision required`

---

## Completed ✅

- Monorepo scaffold (pnpm workspaces): `apps/web`, `apps/worker`, `packages/{config,rules,ai,shared}` + six documented stub packages.
- Deterministic rules kernel (`@aflo/rules`): lifecycle stages, readiness-stage rules (`readiness.v1.0.0`), engagement rules (`engagement.v1.0.0`), rule metadata registry (stable id, version, effective date, inputs/output, reason codes, change history) with lockstep tests.
- AI boundary (`@aflo/ai`): 12-agent roster, charter output envelope; compliance-guard hard-stop semantics.
- Domain + repositories (`@aflo/shared`): typed model, repository interfaces, in-memory mock implementations over synthetic Golden Key data (fixed demo clock), org-scoped record-by-record with a foreign-org leak regression test.
- Staff portal visual slice: sign-in shell, dashboard (KPIs, stage distribution, pipeline, needs-attention, appointments), lead/client list, client detail (stage + reason codes + rule version, roadmap, monthly actions, documents, appointment, engagement, quarterly report preview, AI drafts with confidence + review status).
- Documentation set reconciled to the Product Charter: charter, V1 scope, database schema proposal, authorization matrix (incl. Organization Admin), agent boundaries, ADR-0001…0006, compliance baseline, Golden Key workflow discovery questions, design system, deployment notes.
- CLAUDE.md reconciled to the 12-agent contract, expanded stack, Organization Admin role, and auto-merge policy.
- CI (GitHub Actions): typecheck, lint, unit tests (42), build, **critical Playwright e2e (5)**, report-only dependency audit.
- Env examples (`apps/web`, `apps/worker`) — placeholders only.

## In progress 🔨

- Merge PR #2 into `main` under the auto-merge gates.

## Next ⏭

- Deployment configuration prepared for Vercel (`apps/web`) and Railway (`apps/worker`); Neon connection deferred until database-backed code exists.
- Deterministic billing state-machine rules (`packages/billing`) — invoice/subscription/payment state transitions as pure, versioned, tested logic (no Stripe credentials required).
- Administrative settings layer (typed configuration: pipeline stages, service packages, templates, education modules, appointment types, staff assignments, partner categories, billing terms, reminder schedules).
- Event model / outbox typed contracts (`packages/shared`).
- Notifications templates + mock delivery (`packages/notifications`).

## Blocked ⛔ / Founder decision required 👤

- **Vercel / Railway / Neon / Stripe / Clerk activation** — requires founder account authorization and environment secrets (charter stop conditions #3, #7). Configuration is prepared in-repo; activation waits on the founder connecting accounts and providing secrets via the platform dashboards (never in the repo).
- **Auth provider (ADR-0006)** 👤 — Clerk recommended, Auth.js fallback; awaiting founder decision. Needed before the authentication slice (Sprint 3), not blocking current work.
- **Production Stripe charges** ⛔ — disabled until valid credentials and founder-approved service packages exist; all billing work stays in test-mode / pure logic until then.
- **Golden Key workflow specifics** 👤 — `docs/research/GOLDEN_KEY_WORKFLOW_DISCOVERY.md` holds TBD questions for Natalia; assumptions stay configurable until answered.

## Security review required 🔒

- Any change to payment-webhook verification, authorization/tenant-isolation boundaries, or sensitive-data controls will be opened as a PR and held for founder review (never auto-merged).

## Deferred 🕓

- Neon-backed repository implementations (ADR-0002 mock-first; swap behind unchanged interfaces).
- Real document storage + signed URLs, malware scanning (future requirement).
- Turborepo/Nx (deferred per ADR-0004).

## Deployment status

- **main**: will contain the deployable monorepo after PR #2 merges.
- **Vercel**: not yet imported — configuration prepared; import requires founder account (see Blocked).
- **Railway**: not yet created — build/start commands and config documented; requires founder account.
- **Neon**: no branches provisioned — deferred until database-backed code lands.
