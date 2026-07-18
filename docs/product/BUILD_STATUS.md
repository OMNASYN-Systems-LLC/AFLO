# AFLO Build Status

Living status of the AFLO V1 build. Updated every implementation cycle. Newest state at top of each list.

_Last updated: 2026-07-18 · PRs #2, #3, #16–#21 merged to `main`. Founder decisions applied: Clerk accepted (ADR-0006), Neon provisioned, Control Plane Delta brand. Client-lifecycle workstream (slices A–J) underway; commercial-grade execution priority in effect._

## Legend

`✅ done` · `🔨 in progress` · `⏭ next` · `⛔ blocked` · `🕓 deferred` · `🔒 security review required` · `👤 founder decision required`

---

## Completed ✅

- **Slice A — domain event model** (`packages/shared/src/events`): 25 versioned lifecycle event contracts with exhaustive payload map, validating fail-closed factory, correlation/causation threading, deterministic serialization (11 tests). **Merged (PR #18).**
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

- Client-lifecycle slice B: outbox typed contracts + deterministic claim/complete/fail rules (`outbox.v1.0.0`) + ADR-0008. **Merged (PR #19).**
- Slice C1: deterministic pipeline rules (`pipeline.v1.0.0`). **Merged (PR #20).**
- Slice C2 — staff lead conversion (commercial-grade mandate captured in `COMMERCIAL_GRADE_V1.md`): configurable pipeline stage ids + client status; mutable AfloStore applying rules-gated mutations with outbox events and an append-only audit trail; staff Lead Pipeline workspace with only rule-legal actions; server-side-session-only tenancy for mutations. **Merged (PR #21).**
- Slice D — client intake: deterministic intake-completeness rules (`intake.v1.0.0`); `IntakeSectionCompleted` event (26 types); store workflow with pipeline↔intake consistency gates in both directions; staff intake workspace. **Merged (PR #22).**
- Slice E — readiness assessment workflow: recorded assessment history with deterministic review gate (`review.v1.0.0`) and threshold-interpolated next actions; blocked attempts audited, never recorded. **Merged (PR #23).**
- Slice F — roadmap approval workflow: `roadmap.v1.0.0` allow-list state machine, `Roadmap` entity, `RoadmapPublished` event (27 types), approval stamping/withdrawal, rule-legal staff actions. **Merged (PR #24).**
- Slice G — monthly action plan workflow: `action.v1.0.0` status rules, manual creation with `TaskAssigned`, completion with `TaskCompleted`, rule-legal plan-card actions. **Merged (PR #25).**
- Slice H — quarterly report workflow: `report.v1.0.0` rules, deterministic generation from recorded facts only, `ProgressReportPublished` event (28 types), review-gated publication. **Merged (PR #26).**
- Slice I — client portal: `PortalView` published-only projection, fail-closed identity, `/portal` client shell, demo client session. **Merged (PR #27).**
- Slice J — staff workflow completion: `document.v1.0.0` review-state rules, `requestDocument`/`transitionDocument`/`scheduleAppointment`/`addNote` store workflows with `DocumentRequested`/`DocumentUploaded`/`DocumentReviewed`/`AppointmentScheduled` events, client-detail document/appointment/note controls. **Merged (PR #28).**
- Slice K — auth adapter boundary: `@aflo/auth` activated — provider-neutral session contract, fail-closed guards, demo providers; `apps/web` routed through the boundary; Vercel connected. **Merged (PR #29).**
- Slice L — notifications kernel: `@aflo/notifications` activated — `notification.v1.0.0` consent-gated delivery (consent gate, typed templates, delivery state machine, mock provider), 18 tests. **Merged (PR #30).**
- Slice M — notification wiring: the kernel wired into the store; workflow events plan consent-gated communications recorded in a staff-visible log (revoked-consent sends suppressed and recorded, never silent). **Merged (PR #31).**
- Slice N — Drizzle schema foundation: `@aflo/database` activated (ADR-0005) — kernel-derived Postgres enums + core tables matching the implemented model, offline-generated migration, 9 lockstep tests. **Merged (PR #32).**
- Slice O — round-up simulator: `roundup.v1.0.0` deterministic calculator (SIMULATION ONLY), simulation domain + rule-computed seed, store workflows, client-detail simulator card. **Merged (PR #33).**
- **Slice P — goals workflow**: store `createGoal` (validated, emits `GoalCreated` — the catalog event's first producer; single-primary enforced), `updateGoalProgress` (0–100), `setPrimaryGoal` (exclusive), all audited + isolated; client-detail Goals card with add/edit-progress/make-primary controls. 8 store tests + a goals e2e. _In PR (branch `claude/goals-workflow`)._
- Founder-action-gated (credentials/accounts, not code): Neon connection + repository swap (`DATABASE_URL`), outbox worker (needs the shared DB), Clerk activation (keys), Resend activation (keys), Stripe test-mode billing (keys + approved packages). Remaining credential-free modules: admin settings layer, engagement/retention analytics, observability instrumentation.

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
