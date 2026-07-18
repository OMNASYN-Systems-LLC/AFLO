# AFLO Build Status

Living status of the AFLO V1 build. Updated every implementation cycle. Newest state at top of each list.

_Last updated: 2026-07-18 · PRs #2, #3, #16 merged to `main`. Founder decisions applied: Clerk accepted (ADR-0006), Neon provisioned, Control Plane Delta brand. Client-lifecycle workstream (slices A–J) underway._

## Legend

`✅ done` · `🔨 in progress` · `⏭ next` · `⛔ blocked` · `🕓 deferred` · `🔒 security review required` · `👤 founder decision required`

---

## Completed ✅

- **Slice A — domain event model** (`packages/shared/src/events`): 25 versioned lifecycle event contracts with exhaustive payload map, validating fail-closed factory, correlation/causation threading, deterministic serialization (11 tests). _In PR (branch `claude/event-model`)._
- Founder decisions applied (**merged PR #17**): ADR-0006 Accepted (Clerk), Neon provisioned status, two-level brand system doc.

- Monorepo scaffold (pnpm workspaces): `apps/web`, `apps/worker`, `packages/{config,rules,ai,shared}` + six documented stub packages.
- Deterministic rules kernel (`@aflo/rules`): lifecycle stages, readiness-stage rules (`readiness.v1.0.0`), engagement rules (`engagement.v1.0.0`), rule metadata registry (stable id, version, effective date, inputs/output, reason codes, change history) with lockstep tests.
- AI boundary (`@aflo/ai`): 12-agent roster, charter output envelope; compliance-guard hard-stop semantics.
- Domain + repositories (`@aflo/shared`): typed model, repository interfaces, in-memory mock implementations over synthetic Golden Key data (fixed demo clock), org-scoped record-by-record with a foreign-org leak regression test.
- Staff portal visual slice: sign-in shell, dashboard (KPIs, stage distribution, pipeline, needs-attention, appointments), lead/client list, client detail (stage + reason codes + rule version, roadmap, monthly actions, documents, appointment, engagement, quarterly report preview, AI drafts with confidence + review status).
- Documentation set reconciled to the Product Charter: charter, V1 scope, database schema proposal, authorization matrix (incl. Organization Admin), agent boundaries, ADR-0001…0006, compliance baseline, Golden Key workflow discovery questions, design system, deployment notes.
- CLAUDE.md reconciled to the 12-agent contract, expanded stack, Organization Admin role, and auto-merge policy.
- CI (GitHub Actions): typecheck, lint, unit tests, build, **critical Playwright e2e (5)**, informational dependency audit.
- Env examples (`apps/web`, `apps/worker`) — placeholders only.
- Deployment config-as-code: `apps/web/vercel.json`, `apps/worker/railway.json`; `DEPLOYMENT.md` updated with the account-authorization blockers.
- **PR #2 merged to `main`** — `main` contains the deployable monorepo (merge commit `1d76772`).
- Deterministic billing kernel (`@aflo/billing`, `billing.v1.0.0`): invoice/subscription/payment allow-list state machines with reason codes, `isInvoicePastDue`, the grace-aware subscription-access entitlement gate, and a billing rule registry — pure, Stripe-free, readiness-free (20 tests). **Merged (PR #3).**
- Partner-orchestration roadmap captured as an authoritative founder decision (`PARTNER_ORCHESTRATION_ROADMAP.md`), with ADR-0007, compliance/scope reconciliation, and five gated stub packages (`academy`, `partner-marketplace`, `credit-data`, `opportunity-intelligence`, `embedded-finance`) + `integrations` stub. **Merged (PR #16).**

## In progress 🔨

- Client-lifecycle slice B next: PostgreSQL outbox typed contracts + ADR-0008.

## Next ⏭ (founder-approved build-now order)

1. **Golden Key client lifecycle** — event model / outbox typed contracts, then lead→client conversion, intake, and lifecycle workflows over the existing deterministic stage engine.
2. **Automated email workflows** — `packages/notifications`: template registry, consent/opt-out handling, delivery-event logging, retry/idempotency contracts, mock delivery in dev/preview.
3. **Billing + Stripe test-mode payments** — billing entities DDL, service-package catalog, test-mode invoices/subscriptions consuming the `@aflo/billing` kernel; webhook verification is a founder-review item (never auto-merged).
4. **Wealth Unlockers Academy** — `packages/academy`: staff-authored lesson library, stage/trigger-based assignment from verified facts, completion tracking; completion never unlocks regulated products.
5. **Partner directory + referral tracking** — `packages/partner-marketplace` with the Partner Neutrality Engine record on every recommendation.
6. **Credit-builder opportunity rules (mock providers only)** — deterministic Credit-Building Opportunity Engine; "no new account" is a first-class outcome; no partner names or compensation figures.

## Phased later (gated — see `PARTNER_ORCHESTRATION_ROADMAP.md`)

- **After pilot:** real affiliate integrations · bureau-data provider adapter · credit monitoring/alerts · opportunity & regulatory intelligence feed.
- **After commercial + compliance validation:** embedded credit-builder applications · AFLO-branded secured card (sequence: referrals → embedded apps → co-brand pilot → branded card) · deposit/savings-linked products · interchange-based revenue model.

## Blocked ⛔ / Founder decision required 👤

- **Vercel / Railway / Stripe activation + Clerk/Resend credentials** — requires founder account authorization and environment secrets (charter stop conditions #3, #7). Configuration is prepared in-repo; activation waits on the founder connecting accounts and providing secrets via the platform dashboards (never in the repo).
- ~~Auth provider~~ ✅ **decided 2026-07-18: Clerk** (ADR-0006 Accepted) — implementation behind `packages/auth` adapter when the auth slice lands; credentials prepare-only.
- **Production Stripe charges** ⛔ — disabled until valid credentials and founder-approved service packages exist; all billing work stays in test-mode / pure logic until then.
- **Golden Key workflow specifics** 👤 — `docs/research/GOLDEN_KEY_WORKFLOW_DISCOVERY.md` holds TBD questions for Natalia; assumptions stay configurable until answered.

## Security review required 🔒

- Any change to payment-webhook verification, authorization/tenant-isolation boundaries, or sensitive-data controls will be opened as a PR and held for founder review (never auto-merged).

## Deferred 🕓

- Neon-backed repository implementations (ADR-0002 mock-first; swap behind unchanged interfaces).
- Real document storage + signed URLs, malware scanning (future requirement).
- Turborepo/Nx (deferred per ADR-0004).

## Deployment status

- **main**: contains the deployable monorepo (PRs #2, #3, #16 merged).
- **Vercel**: not yet imported — configuration prepared; import requires founder account (see Blocked).
- **Railway**: not yet created — build/start commands and config documented; requires founder account.
- **Neon**: **provisioned by founder** (`main`/`preview`/`dev` branches exist — never recreate). No code connects until the first Drizzle slice; connection strings live only in provider dashboards.
