# ΛFLO Build Status

Living status of the ΛFLO (technical: AFLO) V1 build. Updated every implementation cycle. Newest state at top of each list.

_Last updated: 2026-07-18 · PRs #2–#39 merged to `main`, plus slices T + U landing now (signed handoff packages + partner referrals/neutrality). Merged surface: client lifecycle A–P, persistence schema, notifications kernel+wiring+preferences, auth boundary, round-up simulator, goals, ΛFLO brand, Wealth Academy, partner referrals + neutrality, signed handoff packages. Founder decisions applied: Clerk accepted (ADR-0006), Neon provisioned, Control Plane Delta brand, **ΛFLO display brand + expanded charter (`FOUNDER_DIRECTIVE_2026-07-18.md`)**. Vercel per-PR previews are live (project `aflo-web`). Now executing the founder's 21-item implementation order; the next decisive milestone is the **Neon-backed persistence pivot** (credential-gated on `DATABASE_URL`); credential-gated items paused, safe work continuing._

## Founder implementation order (2026-07-18) — status

1. Lead→client conversion ✅ · 2. Structured intake ✅ · 3. Neon/Drizzle persistence — schema ✅, **connection ⛔ `DATABASE_URL`**, repository swap ⏭ · 4. Authz/RLS/audit/tenant isolation — app-level audit + tenant tests ✅, **RLS DDL ⏭** · 5. Readiness rules ✅ · 6. Roadmap + monthly actions ✅ · 7. Clerk auth — boundary ✅, **activation ⛔ keys** · 8. Outbox worker ⛔ (needs shared DB) · 9. Notification preferences ✅ · 10. Resend adapter — ⛔ keys (test-mode buildable) · 11. Twilio SMS — ⛔ keys · 12. Wealth Academy ✅ · 13. Reports ✅ + signed handoff packages ✅ · 14. Stripe test-mode ⛔ keys · 15. Partner referrals ✅ · 16. Partner neutrality ✅ · 17. **Credit-data interfaces 🔨 (in PR — provider-neutral, mock only)** · 18. **Behavioral Support (opt-in) ⏭ (next)** · 19. Opportunity registry ⏭ · 20. Pilot 👤 · 21. Provider eval 👤.

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
- Slice P — goals workflow: store `createGoal`/`updateGoalProgress`/`setPrimaryGoal`, `GoalCreated` first producer, single-primary invariant, client-detail Goals card. **Merged (PR #34).**
- Slice Q — ΛFLO brand + charter reconciliation: `FOUNDER_DIRECTIVE_2026-07-18.md` authoritative; `AfloWordmark`/`PoweredByAflo` (ΛFLO display, AFLO accessible name); BRAND_SYSTEM §0; BUILD_STATUS reconciled to the 21-item order. **Merged (PR #35).**
- Slice R — notification preferences (founder order #9): channels + per-type routing + append-only preferences + `resolveDelivery` enforced before send; staff per-channel toggle panel. **Merged (PR #36).**
- **Slice S — ΛFLO Wealth Academy** (founder order #12): `@aflo/academy` activated from stub — versioned content catalog (courses→modules→lessons + ebooks/workshops, `contentVersion`, signed-playback media keys never raw URLs), deterministic `education.v1.0.0` trigger→lesson assignment (`selectEducation` + reason codes) and `scoreKnowledgeCheck` (fail-closed), Golden Key starter library; `EducationAssignment` domain with full provenance; store `assignEducation` (idempotent while open, `EducationAssigned` — first producer) + `completeEducation` (`EducationCompleted`, deterministic knowledge-check score) + `educationFor`; staff Education card on client detail; **portal Wealth Academy surface** (lesson titles + completion, no staff-internal reason codes). Completion is educational only — never gates a regulated product. 7 academy + 7 store tests + academy e2e. **Merged (PR #37).**
- **Slice T — signed verification handoff packages** (founder order #13, ADR-0009): `@aflo/security` activated — `security.v1.0.0` canonical JSON, SHA-256 digest (integrity, not a signature), **Ed25519 asymmetric** sign/verify with self-describing `keyId` (rotation seam), `HandoffPackage` + fail-closed ordered `verifyHandoffPackage` (revoked→digest→key→signature→expiry, specific verdicts). `HandoffFacts` payload is verified facts only — the **ΛFLO readiness stage** (`readinessIsBureauScore: false`, never a bureau score), primary goal, approved-document count, latest published quarter; no SSN/bank/raw-credit data. Store `generateHandoffPackage` fails closed on three gates (server-verified actor, active `partner_data_sharing` consent, a recorded assessment), signs from a dev-only per-process key, audits issuance; `verifyHandoffPackageById` (pure read) + one-way `revokeHandoffPackage` (audited). Staff "Verification handoff" card (generate/verify-verdict/revoke, shows digest + keyId); consent-gate hint when blocked. Type-only facade re-export keeps `node:crypto` server-side. Explicitly **not** audit-proof/legally-verified/underwriting-approved/zero-knowledge. 9 security + 10 store tests + handoff e2e (3). **Merged (PR #38)** — founder-reviewed for crypto key handling.
- **Slice U — tracked partner referrals + Partner Neutrality Engine** (founder order #15–#16, ADR-0010): `@aflo/partner-marketplace` activated from stub — `partner.v1.0.0` referral lifecycle allow-list (`suggested → shared_with_client → client_engaged → outcome_recorded`, `declined` from any non-terminal), the eight-field `NeutralityRecord` with fail-closed `validateNeutralityRecord`, and `orderPartnerOptions` (non-commercial-first then name, **never** by compensation). `PartnerReferral` domain record + synthetic partner directory (fictional names, dollar-free disclosures — ADR-0007). Store `createReferral` (fails closed without a complete neutrality record; emits `PartnerReferralCreated`), `transitionReferral`, `recordReferralOutcome` (staff observation, never an approval) + `partnersFor`/`referralsFor`; all audited, org/actor scoped, isolated from the readiness engine. Staff "Partner referrals" card (create with neutrality disclosure, route the lifecycle, record outcome). 9 marketplace + 8 store tests + partner-referrals e2e (2). **Merged (PR #39).**
- **Slice V — provider-neutral credit-data interfaces** (founder order #17, ADR-0007 §5): `@aflo/credit-data` activated from stub — `credit-data.v1.0.0` normalized bureau-agnostic model (`NormalizedCreditReport`, tradelines, inquiries, scores), the `CreditDataProvider` adapter interface (`isProduction` false for all V1 providers), deterministic `summarizeCreditReport` → readiness-relevant `CreditFacts` (utilization, derogatory count, trailing-year hard inquiries, on-time rate; null utilization guarded), and a synthetic `MockCreditDataProvider` + `syntheticCreditReport` (rejects unknown subjects, never fabricates). No production bureau, no FCRA-gated data, no readiness-stage derivation; `subjectRef` is a client id, never a real SSN. Pure library — store/UI wiring is a follow-up. 6 tests. _In PR (branch `claude/credit-data-interfaces`)._
- Founder-action-gated (credentials/accounts, not code): Neon connection + repository swap (`DATABASE_URL`), outbox worker (needs the shared DB), Clerk activation (keys), Resend activation (keys), Stripe test-mode billing (keys + approved packages). Remaining credential-free modules: admin settings layer, engagement/retention analytics, observability instrumentation.

## Next ⏭ (forward order — the persistence pivot is the decisive milestone)

The synthetic-module surface is broad; the next decisive work moves it from in-memory demonstration to durable, restart-safe operation. Credential-free work continues in parallel.

1. **Credit-data interfaces (founder order #17)** — provider-neutral normalized AFLO credit model behind an adapter, mock provider only; no production bureau, no FCRA-gated data (ADR-0007 §5). Credential-free.
2. **Neon-backed persistence pivot** — complete the Drizzle workflow tables, generate/apply migrations to the Neon `dev` branch, build Neon repository implementations behind the existing interfaces, add mock-vs-Neon parity tests, then swap the store. **Gated on `DATABASE_URL`.**
3. **Database-level RLS (founder order #4)** — org-scoped row-level security as defense-in-depth over the app-level isolation already tested.
4. **Clerk activation (order #7)** and **Railway outbox worker (order #8)** — both gated on credentials / the shared database.
5. **Behavioral Support Engine (order #18, opt-in)** and **opportunity registry (order #19)** — credential-free, deterministic, safe-language.
6. **Real communications (Resend/Twilio), Stripe test mode, and document storage** — each gated on credentials/accounts.

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

- **main**: contains the deployable monorepo through slice U (partner referrals) + slice T (signed handoff packages).
- **Vercel**: **connected** (project `aflo-web`, root `apps/web`) — per-PR preview deployments build and deploy on every push. Production promotion + env vars remain a founder action.
- **Railway**: not yet created — build/start commands and config documented; requires founder account. The worker stays inactive until the shared Neon database is connected.
- **Neon**: **provisioned by founder** (`main`/`preview`/`dev` branches exist — never recreate). The app is still mock-backed; no code connects until the Neon repository swap, and connection strings live only in provider dashboards (`DATABASE_URL`).
- **Repository visibility**: recommend setting the GitHub repo to **private** before real credentials, vendor details, or pilot config are added (a founder admin action in repo Settings → Change visibility). Everything committed today is synthetic — no secrets or real PII.
