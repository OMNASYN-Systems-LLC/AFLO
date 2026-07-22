# Credit Intelligence Engine — Agent Boundary Specification

Status: Draft for V1 ("Golden Key Wealth, powered by AFLO")
Applies to: `packages/ai` (orchestrator + sub-agents), `packages/rules` (deterministic kernel), `apps/worker` (AI job execution)
Related: `docs/product/PRODUCT_CHARTER.md` ("Credit Intelligence Engine", "Agent output contract", "AI context layer" — authoritative), `packages/ai/src/envelope.ts` (code-canonical envelope), `docs/architecture/DATABASE_SCHEMA.md` §9.3, `docs/architecture/INITIAL_ARCHITECTURE.md`, `/CLAUDE.md`

This document defines what each sub-agent of the Credit Intelligence Engine may read, may produce, and may never do. It is the enforcement contract for the boundary between deterministic financial logic and probabilistic AI output. Where this document and `packages/ai/src/envelope.ts` differ, the code is canonical; where this document and the Product Charter differ, the charter is authoritative.

---

## 1. Orchestrator Model

The Credit Intelligence Engine is **one orchestration service** hosting **twelve logical sub-agents**. Sub-agents are prompt/tooling configurations inside that service — typed internal modules with deterministic tools and mock AI responses to begin with — not independently deployed services, and never independently privileged.

```text
Verified Client Facts (Neon, org-scoped)
        ↓
Deterministic Logic Kernel  (packages/rules — pure, unit-tested, versioned)
  utilization • debt ratios • stage thresholds • completion metrics • routing gates
        ↓
Credit Orchestrator (single service, single set of credentials)
  ├── intake-completeness-agent
  ├── credit-profile-agent
  ├── utilization-agent
  ├── payment-history-agent
  ├── debt-obligation-agent
  ├── readiness-stage-agent
  ├── roadmap-agent
  ├── education-agent
  ├── engagement-agent
  ├── report-agent
  ├── partner-routing-agent
  └── compliance-guard-agent   (always runs last, over the others' proposed outputs)
        ↓
Typed AgentEnvelope (packages/ai/src/envelope.ts — validated before persistence)
        ↓
Compliance Guard pass  →  Review Gates (staff review / explicit user approval where required)
        ↓
Application services write approved outcomes + audit events
```

Naming note: `readiness-agent` from earlier drafts is now **`readiness-stage-agent`**, matching the charter and the `AGENT_NAMES` constant in `packages/ai/src/envelope.ts`.

Non-negotiable rules:

1. **No direct writes.** Sub-agents have zero database write access. All proposed mutations pass through application services that validate permissions, tenant scope, rule versions, review requirements, and emit audit events.
2. **No direct reads.** The orchestrator assembles each agent's input context from repositories; agents cannot issue queries. Input is always org-scoped and client-scoped before it reaches a prompt.
3. **No agent-to-agent side channels.** Agents communicate only through the orchestrator, which passes validated envelopes between steps.
4. **No tool escalation.** Agents have no network access, no email/notification sending, no document mutation, no scheduling. They return text and structured data; the platform decides what happens next.
5. **Schema or nothing.** Any response that fails envelope validation is discarded and recorded as a failed `ai_run`. Free-form output is never persisted as fact.
6. **Compliance Guard runs last.** The compliance-guard-agent evaluates every other agent's proposed output before anything is routed onward. Any entry in `prohibited_actions_detected` hard-stops the run: `status` is forced to `"blocked"`, an audit event is written, and nothing reaches a review queue (see §3.12 and §6).

---

## 2. Deterministic / Probabilistic Split

This mirrors the AFLO isolation protocol: an **AI Context Shell** wrapped around a **Deterministic Logic Kernel**.

| Concern | Owner | Notes |
| --- | --- | --- |
| Utilization, debt ratios, budget math | Deterministic kernel (`packages/rules`) | Pure functions, unit-tested, versioned |
| Stage thresholds and stage assignment | Deterministic kernel | Versioned rule sets; reason codes emitted by rules |
| Completion metrics, engagement timers | Deterministic kernel | e.g., days-since-last-activity |
| Partner-routing eligibility gates | Deterministic kernel | Versioned routing rules with reason codes |
| Ledger/fact writes, audit events | Application services | Never invoked by an agent |
| Summaries, explanations, drafts | AI Context Shell (sub-agents) | Always wrapped in the typed envelope |
| Tentative classification, gap detection | AI Context Shell | Marked tentative; requires review to become fact |
| Clarifying questions | AI Context Shell | Preferred output under low confidence |

Hard consequences:

- **The LLM never computes utilization.** The utilization-agent *receives* the kernel's computed value and explains it.
- **The LLM never picks a lifecycle stage.** The readiness rules (versioned in `packages/rules`) determine the stage; the readiness-stage-agent narrates the rule outcome and its reason codes.
- **The LLM never writes to the ledger or any financial fact table.** It proposes; application services dispose.
- Every number an agent mentions must be traceable to a `facts_used` or `rule_versions_used` entry. Numbers with no provenance are treated as hallucinations and the run is rejected.

---

## 3. Sub-Agent Specifications

Shared constraints for all twelve agents:

- **Allowed inputs (exhaustive):** verified client facts (staff-entered or client-confirmed records from Neon), deterministic calculator outputs, rule set versions and their emitted reason codes, and prior *approved* agent outputs. Raw unverified uploads reach an agent only when its spec says so, and only as text to summarize — never as a source of new facts.
- **Prohibited for all** (per the charter's "AI may not independently" list): altering or modifying verified financial facts; guaranteeing credit improvements or score outcomes; approving or denying credit/loans; initiating or drafting credit bureau disputes; determining final tax treatment; selecting investments; executing payments or transferring/custodying money; submitting government applications; selling insurance; contacting clients, bureaus, creditors, or partners directly; inventing numeric values not present in inputs; overriding a deterministic rule outcome or a human-approved exception.

### 3.1 intake-completeness-agent

| | |
| --- | --- |
| Purpose | Identify missing intake fields and documents; produce clarification requests. |
| Allowed inputs | Intake and financial-profile records; kernel intake-completeness and document-completeness rule results with rule versions; org-configured required-field and document checklists; document metadata and review statuses. |
| Allowed outputs | List of missing or incomplete fields/documents (echoed into `missing_facts`); clarification requests for staff or client as proposed actions; suggested collection order. |
| Prohibited | Marking intake or a document complete or verified; creating or editing intake records; inferring or defaulting values for missing fields; contacting the client directly. |

### 3.2 credit-profile-agent

| | |
| --- | --- |
| Purpose | Summarize user-provided credit information and flag facts requiring staff verification. |
| Allowed inputs | Verified financial profile, credit profile (manually entered scores, staff-reviewed report metadata), goals, profile completeness metrics from the kernel. |
| Allowed outputs | Plain-language profile summary; list of missing/stale fields (echoed into `missing_facts`); clarifying questions for staff or client; tentative flags on entries requiring staff verification (`requires_human_review: true`). |
| Prohibited | Estimating or inferring credit scores; asserting bureau data; marking any field verified; editing profile records. |

### 3.3 utilization-agent

| | |
| --- | --- |
| Purpose | Explain kernel-computed utilization and threshold test results. |
| Allowed inputs | Kernel outputs: per-account and aggregate utilization, threshold rule results with rule version, debt/limit facts used by the kernel. |
| Allowed outputs | Explanation of the computed values; which threshold rules passed/failed and why (echoing kernel reason codes); educational framing of utilization concepts. |
| Prohibited | Computing or recomputing utilization; proposing alternative values; guaranteeing or predicting score impact; recommending balance transfers, new credit lines, or specific payments as directives (may only surface kernel-derived observations for staff to act on). |

### 3.4 payment-history-agent

| | |
| --- | --- |
| Purpose | Organize and summarize user-entered or uploaded payment history in neutral language; flag inconsistencies. |
| Allowed inputs | Staff/client-entered payment history records; text extracted from uploaded documents already in review workflow; kernel-computed recency/frequency metrics. |
| Allowed outputs | Neutral summary of reported history; identification of gaps, ambiguities, and inconsistencies; clarifying questions; flags for staff review of ambiguous entries. |
| Prohibited | Drafting, suggesting, or wording disputes; asserting an item is inaccurate, erroneous, or removable; contacting bureaus or creditors; converting uploaded text into verified facts. |

### 3.5 debt-obligation-agent

| | |
| --- | --- |
| Purpose | Summarize balances and monthly obligations in support of readiness calculations. |
| Allowed inputs | Verified debt records (balances, limits, rates as entered), monthly obligation records, income-source facts, kernel debt-ratio and obligation-total outputs with rule versions. |
| Allowed outputs | Neutral summary of balances and monthly obligations; identification of gaps or inconsistent entries (echoed into `missing_facts` and staff-review flags); clarifying questions; narrative context supporting readiness evaluation. |
| Prohibited | Computing or recomputing ratios and totals (the kernel does); recommending consolidation, settlement, payoff ordering, or debt products as directives; negotiating with or contacting creditors; editing debt or obligation records. |

### 3.6 readiness-stage-agent

*(Renamed from `readiness-agent` in earlier drafts.)*

| | |
| --- | --- |
| Purpose | Narrate the outcome of the versioned deterministic readiness-stage rule evaluation, returning its reason codes. |
| Allowed inputs | Kernel-evaluated readiness result: assigned stage, rule set version, reason codes, threshold values, verified facts the rules consumed, any human-approved stage exceptions on record. |
| Allowed outputs | Explanation of the current stage and what the reason codes mean; what deterministic conditions would need to change for the next stage (as stated by the rules, not invented); clarifying questions when required facts are missing (echoed into `missing_facts`). |
| Prohibited | Assigning, changing, or overriding a stage; silently overriding a human-approved stage exception; inventing stage criteria; promising timelines or outcomes. |

### 3.7 roadmap-agent

| | |
| --- | --- |
| Purpose | Draft a roadmap (milestones, monthly actions) from verified facts, deterministic outputs, and approved templates. |
| Allowed inputs | Approved facts, current stage + reason codes, goals, kernel completion metrics, prior approved roadmaps, org-configured (approved) milestone templates. |
| Allowed outputs | Draft roadmap and monthly action plan **always** marked `requires_human_review: true`; rationale linking each proposed item to facts and reason codes. |
| Prohibited | Publishing a roadmap to a client without staff approval; making legal or regulated decisions; including regulated actions (disputes, filings, transfers, product purchases) as tasks; setting due dates that conflict with deterministic scheduling rules. |

### 3.8 education-agent

| | |
| --- | --- |
| Purpose | Select education relevant to the client's current stage and current task from the approved content library. |
| Allowed inputs | Approved content catalog with metadata/tags; current stage and reason codes; current tasks; goals; engagement history. |
| Allowed outputs | Ranked content selections with reasons; identification of catalog gaps. |
| Prohibited | Authoring new educational or advice content in V1; recommending external products, lenders, or services; framing education as personalized financial advice. |

### 3.9 engagement-agent

| | |
| --- | --- |
| Purpose | Interpret kernel-detected inactivity, incomplete tasks, missed reviews, and missing documents, and recommend follow-up for staff. |
| Allowed inputs | Kernel engagement metrics (last activity, task completion rates, appointment attendance, missed reviews, missing documents), communication metadata (timestamps/channel only, no bodies), org follow-up policy configuration. |
| Allowed outputs | Engagement risk narrative; recommended follow-up actions for staff; draft outreach message text (`requires_human_review: true`). |
| Prohibited | Sending any message; scheduling appointments; changing engagement-risk flags directly (the kernel's inactivity detection sets the flag; the agent explains it). |

### 3.10 report-agent

| | |
| --- | --- |
| Purpose | Draft quarterly progress report narratives from verified, approved data. |
| Allowed inputs | Approved facts, stage history with rule versions, completed/pending milestones and tasks, kernel progress metrics, document statuses, prior approved reports. |
| Allowed outputs | Draft report narrative and section summaries, **always** `requires_human_review: true`; every figure traceable to `facts_used`. |
| Prohibited | Publishing or sending a report; including projections, guarantees, or score predictions; introducing any number not present in inputs. |

### 3.11 partner-routing-agent

| | |
| --- | --- |
| Purpose | Propose partner referrals from approved eligibility and routing rules. |
| Allowed inputs | Partner directory entries with approved eligibility criteria; kernel partner-routing gate results with rule versions and reason codes; current stage and goals; consent records covering referral data sharing. |
| Allowed outputs | Draft referral proposals (**always** `requires_human_review: true`) with rationale linking to routing-gate outcomes; explanation of why a routing gate passed or failed; identification of missing facts blocking a gate (echoed into `missing_facts`). |
| Prohibited | Sending referrals or contacting partners; approving or denying loans; guaranteeing partner acceptance, pricing, terms, or outcomes; proposing a referral without a recorded consent covering the shared data; inventing eligibility criteria. |

### 3.12 compliance-guard-agent

The Compliance Guard occupies a special position: it is not a content producer. It **always runs last**, over the proposed outputs of the other eleven agents, and no envelope reaches a review gate without passing it.

| | |
| --- | --- |
| Purpose | Evaluate other agents' proposed outputs for prohibited claims and actions; block unsafe language and unsupported recommendations. |
| Allowed inputs | The other agents' validated envelopes (proposed actions, narratives, and the facts/rule versions they reference); the versioned prohibited-action policy list derived from the charter's "AI may not independently" list. |
| Allowed outputs | Pass/block determination for the run; `prohibited_actions_detected` codes with a plain explanation of each detection for staff; identification of unsupported (provenance-free) claims. |
| Prohibited | Rewriting, redacting, or "fixing" another agent's output; clearing or downgrading its own detections; approving content (approval is human-only); being bypassed for any output class. |

Hard-stop semantics: **any** entry in `prohibited_actions_detected` hard-stops the run — the envelope's `status` is forced to `"blocked"`, all proposed actions are discarded, a `prohibited_action` audit event is written, and nothing from the run reaches a review queue (see §6).

---

## 4. Typed Response Envelope

Every agent invocation MUST return exactly one `AgentEnvelope`. The orchestrator validates it (e.g., with Zod) before anything is persisted or shown.

The envelope is **code-canonical** in `packages/ai/src/envelope.ts`; the interface below is reproduced verbatim from that file, and the code wins on any divergence. Field names are camelCase in code and JSON transport; the charter's agent output contract and the `ai_runs` columns (§8) use the snake_case equivalents (`facts_used`, `missing_facts`, `rule_versions_used`, `reason_codes`, `proposed_actions`, `prohibited_actions_detected`, `requires_human_review`, `review_status`).

```typescript
export const AGENT_NAMES = [
  "intake-completeness-agent",
  "credit-profile-agent",
  "utilization-agent",
  "payment-history-agent",
  "debt-obligation-agent",
  "readiness-stage-agent",
  "roadmap-agent",
  "education-agent",
  "engagement-agent",
  "report-agent",
  "partner-routing-agent",
  "compliance-guard-agent",
] as const;

export type AgentName = (typeof AGENT_NAMES)[number];

export type AgentStatus =
  | "ok"
  | "needs_clarification"
  | "insufficient_data"
  | "blocked";

export type ReviewStatus =
  | "pending_review"
  | "approved"
  | "rejected"
  | "auto_published"; // allowed only for low-impact informational output

export interface ProposedAction {
  id: string;
  summary: string;
  rationale: string;
  impact: "low" | "medium" | "high";
}

export interface AgentEnvelope {
  /** Stable identifier for the run that produced this envelope (ai_runs.id). */
  id: string;
  agentName: AgentName;
  /** Version of the agent implementation that produced this output. */
  agentVersion: string;
  organizationId: string;
  clientId: string;
  status: AgentStatus;
  /** Model self-estimate in [0,1]; deterministic facts are never "confident" — they are facts. */
  confidence: number;
  /** Identifiers of verified facts the agent was given (e.g. "credit_profiles.score"). */
  factsUsed: string[];
  /** Facts the agent needed but did not have — drives clarification requests. */
  missingFacts: string[];
  /** Versioned deterministic rules consulted (e.g. "readiness.v1.0.0"). */
  ruleVersionsUsed: string[];
  /** Reason codes emitted by deterministic calculators, echoed for traceability. */
  reasonCodes: string[];
  proposedActions: ProposedAction[];
  /** Prohibited-action codes detected by the Compliance Guard; non-empty hard-stops the run. */
  prohibitedActionsDetected: string[];
  requiresHumanReview: boolean;
  reviewStatus: ReviewStatus;
  createdAt: string; // ISO datetime
}
```

Example — readiness-stage-agent, healthy staff-facing run:

```json
{
  "id": "airun_01J9ZK3W8Q4N",
  "agentName": "readiness-stage-agent",
  "agentVersion": "1.2.0",
  "organizationId": "org_goldenkey",
  "clientId": "client_42",
  "status": "ok",
  "confidence": 0.88,
  "factsUsed": [
    "credit_profiles.reported_score:cp_310",
    "debts.balance:debt_881",
    "debts.credit_limit:debt_881",
    "monthly_obligations.amount:ob_204",
    "calc.utilization.aggregate:client_42",
    "calc.readiness.stage:client_42"
  ],
  "missingFacts": [
    "income_sources.monthly_amount:client_42"
  ],
  "ruleVersionsUsed": ["readiness.v1.0.0", "utilization.v1.1.0"],
  "reasonCodes": ["UTIL_ABOVE_30PCT", "NO_RECENT_LATES_12M", "STAGE_STABILIZATION_HELD"],
  "proposedActions": [
    {
      "id": "pa_1",
      "summary": "Explain why the client remains in Stabilization",
      "rationale": "Rule set readiness.v1.0.0 held the stage at Stabilization because aggregate utilization (calc.utilization.aggregate:client_42) is above the 30% threshold (UTIL_ABOVE_30PCT), while reported payment history is clean (NO_RECENT_LATES_12M).",
      "impact": "low"
    },
    {
      "id": "pa_2",
      "summary": "Ask the client to confirm monthly income",
      "rationale": "Monthly income is missing (income_sources.monthly_amount:client_42), so the debt-to-income input to the Credit Readiness gate could not be evaluated.",
      "impact": "low"
    }
  ],
  "prohibitedActionsDetected": [],
  "requiresHumanReview": false,
  "reviewStatus": "auto_published",
  "createdAt": "2026-07-16T14:03:00Z"
}
```

Validation rules enforced by the orchestrator:

- `confidence` ∈ [0, 1]; `factsUsed` and `ruleVersionsUsed` may be empty only when `status` is `"blocked"` or `"insufficient_data"`.
- `missingFacts` must be non-empty when `status` is `"needs_clarification"` or `"insufficient_data"`.
- Every fact identifier and reason code referenced in a `proposedActions[].rationale` must appear in `factsUsed` / `reasonCodes` respectively; `reasonCodes` must be a subset of codes emitted by the referenced `ruleVersionsUsed`.
- A non-empty `prohibitedActionsDetected` forces `status: "blocked"`; blocked envelopes are never routed to review queues (see §6).
- `reviewStatus: "auto_published"` is valid only for low-impact informational output (§5); everything else enters `"pending_review"`.
- roadmap-agent, report-agent, and partner-routing-agent envelopes with `requiresHumanReview: false` are rejected (their output is high-impact by definition).

---

## 5. Review Gates

Review gates only ever see envelopes that have passed the Compliance Guard (§3.12); a blocked run never enters this table.

| Output | Impact class | Gate before visible/actionable |
| --- | --- | --- |
| Draft roadmap / milestones / monthly actions | High | Staff review and approval; client sees only approved versions |
| Draft quarterly report | High | Staff review and approval before generation/sending |
| Draft outreach/follow-up message text | High | Staff review; sending is a separate audited action |
| Draft partner referral | High | Staff review and approval; referral sending is a separate audited action requiring recorded consent |
| Tentative classification or inconsistency flag on profile data | High | Staff confirms before any fact record changes |
| Stage-change narrative after a kernel stage transition | Medium | Auto-visible to staff; client-facing explanation requires staff approval in V1 |
| Education content selection | Medium | Auto-assignable within the approved catalog; staff may override |
| Internal summaries, missing-item lists, clarification requests to staff | Low | No gate (`review_status: "auto_published"`); staff-facing only |

Gate mechanics:

- Gated outputs persist with `review_status: "pending_review"`, invisible to clients and excluded from client notifications.
- Approval, edit-then-approve, and rejection are distinct audited actions with actor, timestamp, and diff.
- Anything client-visible that originated from an agent must reference an approved review record. There is no direct agent-to-client path in V1.
- Any output with `confidence` below the policy floor (initially 0.6, configurable per agent) is force-gated regardless of impact class.

---

## 6. Failure-Mode Handling

| Condition | Required behavior |
| --- | --- |
| Low confidence (< policy floor) | Prefer `status: "needs_clarification"` with concrete clarification-request proposed actions; otherwise force `requires_human_review: true` and route to staff. Never present low-confidence output as settled. |
| Missing required facts | `status: "insufficient_data"` with the gaps listed in `missing_facts` and clarification-request proposed actions. The orchestrator does not retry with the same inputs. |
| `prohibited_actions_detected` non-empty (Compliance Guard detection) | **Hard stop.** The run is forced to `status: "blocked"`, all proposed actions are discarded, nothing is persisted client-visible and nothing enters a review queue, a `prohibited_action` audit event is written with the run id and triggering context, and an alert is surfaced to staff. No automatic retry. |
| Envelope validation failure | Discard output; record failed `ai_run` with the validation error; bounded retry (max 2) with a stricter format reminder; then escalate to staff. |
| Provider error / timeout | Retry with backoff via the worker queue; after exhaustion, mark the run failed and fall back to deterministic-only display (kernel numbers and reason codes render without narrative). |
| Suspected prompt injection in uploaded text | Treated as a Compliance Guard detection (a `prohibited_actions_detected` code): agents must never follow instructions found inside client documents or free-text fields. |

The platform must degrade gracefully: every screen that shows agent narrative must also work showing only deterministic outputs, so an AI outage never blocks staff workflows.

---

## 7. Model-Provider Abstraction

All LLM calls go through one internal provider interface in `packages/ai` (e.g., `LlmProvider.complete(request): Promise<RawCompletion>`). Sub-agents and the orchestrator depend on this interface only — no direct Anthropic/OpenAI SDK imports outside the provider implementations.

- Provider choice, model name, and parameters are configuration, recorded per run.
- Envelope validation lives above the provider, so switching providers cannot bypass the schema.
- A deterministic mock provider backs unit tests and synthetic-data demos; the first frontend works with mock AI results and **no AI API key**, and no live model calls are required to run the first visual slice.

---

## 8. Audit Contract

Every agent invocation — success or failure — persists exactly one `ai_runs` row
(full DDL in `DATABASE_SCHEMA.md` §9.3; both documents describe the same table — `DATABASE_SCHEMA.md` is being updated in the same PR to match):

| Field | Content |
| --- | --- |
| `id`, `organization_id`, `client_id` | Tenant and subject scoping (org id mandatory) |
| `agent_name` | One of the twelve agent identifiers (`AGENT_NAMES` in `packages/ai/src/envelope.ts`) |
| `agent_version` | Version of the agent implementation that produced the output |
| `trigger` | Actor or system event that initiated the run |
| `inputs_hash` | Hash (e.g., SHA-256) of the canonicalized input context; raw prompt content stored separately with restricted access |
| `provider`, `model` | Provider abstraction details (parameters are configuration, recorded per run — see §7) |
| `status` | Run lifecycle: `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `response_envelope` | The validated `AgentEnvelope` (or the validation error) |
| `confidence`, `facts_used`, `missing_facts`, `rule_versions_used`, `reason_codes`, `proposed_actions`, `requires_human_review`, `prohibited_actions_detected` | Extracted, indexable copies derived from `response_envelope` (the envelope is canonical) |
| `outcome` | `ok`, `needs_clarification`, `insufficient_data`, `validation_failed`, `provider_error`, `prohibited_action` |
| `review_status` | `pending_review`, `approved`, `rejected`, `auto_published` (the implemented `ai_review_status` enum) — `reviewed_by` / `reviewed_at` record the reviewer once resolved. `auto_published` marks below-gate low-impact output that legitimately skipped review; it is NOT equivalent to a Review Center `published` state, and such runs never enter a review queue |
| `latency_ms`, `input_token_count`, `output_token_count`, `created_at` | Operational metrics |

Additional requirements:

- Approving, editing, or rejecting a gated output emits a linked `audit_events` record; the approved artifact stores the `ai_run` id it came from, giving full lineage: facts → rules → run → review → client-visible artifact.
- `inputs_hash` + `rule_versions_used` make runs reproducible for incident review: the same facts and rule versions can be replayed against the same model configuration.
- `prohibited_action` outcomes are queryable as a first-class safety metric and reviewed regularly.
- Synthetic data only in development; no real client facts may appear in fixtures, logs, or committed prompt examples.
