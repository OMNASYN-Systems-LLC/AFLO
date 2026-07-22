# Founder Directive — 2026-07-20: Strategic Product Differentiation

> **Authority.** Approved founder decision. Per the source-of-truth order this
> directive sits ABOVE `CLAUDE.md`, the architecture docs, and the V1 scope, and
> below only the Product Charter where they conflict (none identified). It
> extends — does not replace — the Production Cutover directive: the
> credential-gated cutover work remains exactly as documented in
> `docs/deployment/AUTH_CUTOVER_RUNBOOK.md`.

## 1. Positioning decision

ΛFLO must **not** compete as a general-purpose financial chatbot. AI alone is
not the moat — a chatbot, dashboard, roadmap generator, or financial summary can
be copied. The defensible product is:

> **narrow operational niche + proprietary workflow + trusted human judgment +
> longitudinal client context + measurable outcomes.**

The initial niche (narrow enough to sell, specific enough to build correctly,
broad enough to expand later):

> **The operating system that helps credit-recovery and financial-readiness
> professionals move clients from confusion to verified readiness, one approved
> action at a time.**

The company narrative:

> Consumers have financial context but lack structure. Small financial
> professionals have expertise but lack technology. Institutions have structure
> but lack the person's full context. **ΛFLO prepares, organizes, verifies, and
> translates that context — while keeping trusted humans responsible for
> high-impact decisions.**

The first product promise (narrow, measurable — not "AI financial platform"):

> Golden Key Wealth, powered by ΛFLO, gives every client a clear
> financial-readiness stage, a personalized action roadmap, ongoing human
> support, and measurable progress.

**Sell operational outcomes, not "AI":** fewer clients lost in onboarding, less
staff time chasing documents, faster action plans, more completed monthly
actions, better retention, visible progress, easier quarterly reviews, organized
referrals, documented staff decisions. For the client: *I know where I am, what
is blocking me, and what to do next — without repeating my story.*

## 2. The core loop (the product architecture)

```text
Client shares situation
→ ΛFLO organizes and verifies the facts
→ deterministic rules identify blockers
→ AI drafts an explanation and possible actions
→ licensed or authorized human reviews high-impact guidance
→ client receives one clear next action
→ ΛFLO tracks completion
→ human follows up when necessary
→ outcome updates the client's profile and roadmap
```

Human review is **not** a disclaimer — it is built into the system's states:

```text
AI drafted → awaiting staff review → approved → published to client
→ client acknowledged → action completed → outcome verified
```

## 3. The defensibility stack (build in layers)

1. **Workflow moat** — encode Golden Key's real operating process (lead
   qualification, readiness triage, document asks, escalation triggers,
   next-action selection, re-engagement messaging, referral gates).
2. **Human-decision moat** — capture staff approvals, edits, overrides, and
   outcomes as STRUCTURED feedback (`AI recommendation → staff decision → reason
   → final action → client response → outcome`), not free-form logs.
3. **Longitudinal context moat** — the client's readiness journey across months
   and years (not "score: 640" but "Recovery → reduced utilization → 3 roadmap
   actions → 1 month reserves → Credit Readiness → preparing mortgage referral").
4. **Verification moat** — every fact labeled: self-reported /
   document-supported / provider-sourced / staff-reviewed /
   professional-verified / expired-or-stale.
5. **Distribution moat** — Golden Key proves it; then credit-education firms,
   financial coaches, housing counselors, CDFIs, mortgage-readiness teams,
   advisory CPAs, employer wellness providers, nonprofits, banks/credit unions
   needing prepared applicants. The sale is "run your entire client-readiness
   process through one system," not "buy our AI."

**Ownership boundary (unchanged from the charter):** ΛFLO owns context,
preparation, interpretation, workflow, verification, consent, handoff, progress,
accountability. Licensed institutions own lending, investments, deposits,
insurance, tax determinations, card issuance, custody, underwriting.

## 4. Five-year backward path

- **Stage 5** — Financial interoperability platform: institutions receive
  permissioned, source-labeled readiness intelligence (needs proven
  verification, longitudinal data, institutional trust, compliance, standards).
- **Stage 4** — Multi-provider lifecycle platform (tenant configuration,
  provider-neutral adapters, professional review workflows, partner outcomes).
- **Stage 3** — Multi-tenant financial-readiness SaaS sold to firms like Golden
  Key (repeatable onboarding, tenant settings, billing, support, ROI evidence).
- **Stage 2** — Successful Golden Key pilot (auth, persistent data, files,
  messaging, calendar, email, roadmaps, actions, reporting, human review,
  Concierge handoff).
- **Stage 1** — **Production conversion (current).** Remove demo identities,
  in-memory repositories, synthetic runtime data, mock communications; activate
  Clerk, Neon, RLS, private storage, Resend, worker, real Golden Key
  configuration. (Data layer complete; wiring is credential-gated — see
  `AUTH_CUTOVER_RUNBOOK.md`.)

## 5. The signature dual experience

Every **client** immediately sees: current stage · primary goal · what is
blocking progress · next approved action · why it matters · who can help · when
progress is reviewed.

Every **staff member** immediately sees: who needs attention · what is missing ·
what AI has drafted · what requires human review · what action is overdue ·
which client is disengaging · what changed since the last review.

## 6. Normative directive (verbatim)

```text
STRATEGIC PRODUCT DIFFERENTIATION DIRECTIVE

ΛFLO must not compete as a general-purpose financial chatbot.

The product's defensibility comes from:

1. Golden Key's real financial-readiness workflow
2. Human review and professional accountability
3. Versioned financial-readiness playbooks
4. Longitudinal client context
5. Source-labeled and verified facts
6. Structured staff approval, rejection, and override data
7. Measurable client outcomes
8. Multi-tenant workflow infrastructure for small professional firms

Implement human-in-the-loop as a first-class workflow architecture.

Create a Human Review Center with review queues for:

- readiness assessments
- roadmap drafts
- Concierge recommendations
- document interpretations
- financial summaries
- educational assignments
- partner referrals
- client communications
- quarterly reports
- stage advancement

Every reviewable artifact must include:

- source facts
- source freshness
- deterministic rules used
- AI model and prompt version when applicable
- confidence
- risk classification
- required reviewer role
- current state
- reviewer
- review timestamp
- decision
- reason code
- modifications
- published result

States:

draft
→ awaiting_review
→ approved
→ published

Alternative terminal states:

rejected
superseded
withdrawn

Never publish high-impact AI output directly to a client.

Create versioned Professional Playbooks.

A playbook contains:

- playbook id
- organization id
- name
- purpose
- applicable lifecycle stages
- triggering conditions
- required facts
- required documents
- deterministic calculations
- question sequence
- educational content
- recommended actions
- prohibited actions
- human-review checkpoints
- escalation criteria
- completion evidence
- outcome metrics
- version
- effective date
- author
- approver
- status

Initial Golden Key playbooks:

- high utilization recovery
- past-due stabilization
- collections preparation
- thin credit profile
- rental readiness
- mortgage readiness
- emergency savings
- debt overload
- business-capital document readiness
- client reengagement

Do not invent Natalia's exact process.

Create editable drafts and a workflow-discovery queue for unresolved decisions.

Capture structured human feedback on AI output:

- approved unchanged
- approved with edits
- rejected
- escalated
- deferred

Reason codes must be structured.

Track whether the final client action was completed and whether the expected
outcome occurred.

Build analytics for:

- approval rate
- edit rate
- rejection rate
- review time
- action completion
- client response
- stage advancement
- playbook effectiveness
- staff consistency
- escalation volume

The human-review and playbook systems are not secondary features.

They are core intellectual-property and product-differentiation layers.
```

## 7. Feedback engine (structured record, governed use)

Whenever staff reviews AI output, record structurally:

```text
review_id, organization_id, staff_member_id, client_stage, workflow_type,
ai_output_version, decision, reason_code, edited_fields, final_output,
client_action, completion_status, outcome
```

**Governance:** this data is NOT used for uncontrolled model training.
Initially it serves product analytics, rule improvement, prompt evaluation,
workflow refinement, staff consistency, and quality assurance. Later, with
explicit consent and governance, it can support tenant-specific intelligence.

## 8. Playbook ownership

AI can help execute a playbook; **the business owns the playbook**. Playbooks
are versioned tenant intellectual property. The 10 initial Golden Key playbooks
ship as **editable drafts** with a workflow-discovery queue capturing every
unresolved decision for the founder/staff — ΛFLO must not fabricate Natalia's
actual process.

## 9. Continuation directive (founder, 2026-07-22): parallel workstreams + architecture constraints

**Differentiation and cutover proceed IN PARALLEL — two coordinated workstreams.**
Workstream B is NOT stopped by missing hosted credentials: all code, dependency
injection, test providers, route wiring, fail-closed configuration, and
acceptance tests that can be built credential-free MUST be built.

- **Workstream A — Product differentiation:** (1) unified review kernel,
  (2) professional playbook kernel, (3) human-feedback records,
  (4) deterministic review analytics, (5) migration 0008 + repositories,
  (6) Human Review Center UI.
- **Workstream B — Production cutover:** (1) tenant + resolver connection
  factories, (2) PostgreSQL repository factory, (3) Clerk provider adapter,
  (4) Clerk webhook route, (5) principal resolution, (6) invitation issuance,
  (7) invitation acceptance, (8) authorization enforcement, (9) persistent
  messaging cutover, (10) demo-runtime removal, (11) preview acceptance suite.

### Review Center architecture (normative)

The Review Center is a **coordination layer, not a second system of record**. A
`ReviewItem` references `artifact_type` + `artifact_id` + `artifact_version` —
it must NOT copy entire artifact state into the review record. Store an
integrity digest or a bounded source snapshot only where required for
auditability. Existing domain records remain authoritative: roadmap, quarterly
report, document, education assignment, referral, Concierge recommendation,
client communication, readiness assessment.

**States.** Primary path: `draft → awaiting_review → approved → published`.
Alternate terminal states: `rejected`, `deferred`, `withdrawn`, `superseded`.
Never allow: `draft → published`, `awaiting_review → published`, or high-impact
AI output becoming client-visible without approval.

**Risk classification.**

- `low` — routine educational assignment, non-sensitive reminder, operational
  follow-up.
- `medium` — client communication draft, roadmap action proposal, budget
  explanation, engagement intervention.
- `high` — readiness-stage changes, credit-related guidance, financial-summary
  publication, document interpretation, partner referral, stage advancement,
  and any legal-, tax-, lending-, investment-, or eligibility-adjacent output.

High-risk items require explicit authorized human approval.

### Playbook governance (normative)

The ten initial Golden Key playbooks remain **editable drafts**. Every playbook
field carries one of: `confirmed` · `assumption` · `discovery_required` ·
`approved`. Natalia's workflow is never encoded without confirmation. A
workflow-discovery item is created for every unresolved: threshold, document
requirement, escalation condition, communication template, reviewer role,
timing rule, completion evidence, expected outcome.

### Feedback governance (normative)

Decisions: approved unchanged · approved with edits · rejected · deferred ·
escalated — with structured reason codes. Track: source accuracy, source
freshness, edit categories, review time, final client action, action
completion, observed outcome. Never used for uncontrolled external-model
training.

### Analytics priority

Operational and client outcomes first: time to roadmap, review backlog, review
time, staff edit rate, staff rejection rate, client action completion, stage
advancement, reengagement, document turnaround, playbook effectiveness,
administrative time saved.

### Delivery standard

A review feature is not done until it has: domain state machine · authorization
· persistence · RLS · audit · client-safe projection · staff workflow · tests ·
deployment path · measurable outcome.

Standing execution rules: continue merging safe PRs after green CI; never touch
Neon `main`.

## 10. Interaction with standing constraints (unchanged)

- AI drafts/explains/classifies-tentatively only; it may not alter financial
  facts, approve loans, select investments, decide disputes, determine tax
  treatment, or execute transfers (charter §Architecture Rules).
- `compliance-guard-agent` remains the hard stop; non-empty
  `prohibited_actions_detected` forces `blocked` and bypasses every queue.
- Deterministic outcomes cannot be overridden by AI; human-approved exceptions
  cannot be silently overridden by rules.
- Tenant isolation, digests-only secrets, ciphertext-only sensitive fields, and
  the fail-closed production runtime contract all continue to apply to every
  new review/playbook table and workflow.
