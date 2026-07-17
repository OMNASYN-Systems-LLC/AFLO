# Credit Intelligence Engine — Agent Boundary Specification

Status: Draft for V1 ("Golden Key Wealth, powered by AFLO")
Applies to: `packages/ai` (orchestrator + sub-agents), `packages/rules` (deterministic kernel), `apps/worker` (AI job execution)
Related: `docs/architecture/INITIAL_ARCHITECTURE.md`, `/CLAUDE.md`

This document defines what each sub-agent of the Credit Intelligence Engine may read, may produce, and may never do. It is the enforcement contract for the boundary between deterministic financial logic and probabilistic AI output.

---

## 1. Orchestrator Model

The Credit Intelligence Engine is **one orchestration service** hosting **eight logical sub-agents**. Sub-agents are prompt/tooling configurations inside that service — not independently deployed services, and never independently privileged.

```text
Verified Client Facts (Neon, org-scoped)
        ↓
Deterministic Logic Kernel  (packages/rules — pure, unit-tested, versioned)
  utilization • debt ratios • stage thresholds • completion metrics
        ↓
Credit Orchestrator (single service, single set of credentials)
  ├── credit-profile-agent
  ├── utilization-agent
  ├── payment-history-agent
  ├── readiness-agent
  ├── roadmap-agent
  ├── education-agent
  ├── engagement-agent
  └── report-agent
        ↓
Typed AgentResponse envelope (validated before persistence)
        ↓
Review Gates (staff review / explicit user approval where required)
        ↓
Application services write approved outcomes + audit events
```

Non-negotiable rules:

1. **No direct writes.** Sub-agents have zero database write access. All proposed mutations pass through application services that validate permissions, tenant scope, rule versions, review requirements, and emit audit events.
2. **No direct reads.** The orchestrator assembles each agent's input context from repositories; agents cannot issue queries. Input is always org-scoped and client-scoped before it reaches a prompt.
3. **No agent-to-agent side channels.** Agents communicate only through the orchestrator, which passes validated envelopes between steps.
4. **No tool escalation.** Agents have no network access, no email/notification sending, no document mutation, no scheduling. They return text and structured data; the platform decides what happens next.
5. **Schema or nothing.** Any response that fails envelope validation is discarded and recorded as a failed `ai_run`. Free-form output is never persisted as fact.

---

## 2. Deterministic / Probabilistic Split

This mirrors the AFLO isolation protocol: an **AI Context Shell** wrapped around a **Deterministic Logic Kernel**.

| Concern | Owner | Notes |
| --- | --- | --- |
| Utilization, debt ratios, budget math | Deterministic kernel (`packages/rules`) | Pure functions, unit-tested, versioned |
| Stage thresholds and stage assignment | Deterministic kernel | Versioned rule sets; reason codes emitted by rules |
| Completion metrics, engagement timers | Deterministic kernel | e.g., days-since-last-activity |
| Ledger/fact writes, audit events | Application services | Never invoked by an agent |
| Summaries, explanations, drafts | AI Context Shell (sub-agents) | Always wrapped in the typed envelope |
| Tentative classification, gap detection | AI Context Shell | Marked tentative; requires review to become fact |
| Clarifying questions | AI Context Shell | Preferred output under low confidence |

Hard consequences:

- **The LLM never computes utilization.** The utilization-agent *receives* the kernel's computed value and explains it.
- **The LLM never picks a lifecycle stage.** The readiness rules (versioned in `packages/rules`) determine the stage; the readiness-agent narrates the rule outcome and its reason codes.
- **The LLM never writes to the ledger or any financial fact table.** It proposes; application services dispose.
- Every number an agent mentions must be traceable to a `facts_used` or `rules_used` entry. Numbers with no provenance are treated as hallucinations and the run is rejected.

---

## 3. Sub-Agent Specifications

Shared constraints for all eight agents:

- **Allowed inputs (exhaustive):** verified client facts (staff-entered or client-confirmed records from Neon), deterministic calculator outputs, rule set versions and their emitted reason codes, and prior *approved* agent outputs. Raw unverified uploads reach an agent only when its spec says so, and only as text to summarize — never as a source of new facts.
- **Prohibited for all:** altering financial facts; approving or denying credit/loans; initiating or drafting credit bureau disputes; determining tax treatment; selecting investments; executing or recommending execution of transfers; contacting clients, bureaus, or partners directly; inventing numeric values not present in inputs; overriding a deterministic rule outcome.

### 3.1 credit-profile-agent

| | |
| --- | --- |
| Purpose | Summarize the verified credit/financial profile and identify missing or stale inputs. |
| Allowed inputs | Verified financial profile, credit profile (manually entered scores, staff-reviewed report metadata), goals, profile completeness metrics from the kernel. |
| Allowed outputs | Plain-language profile summary; list of missing/stale fields; clarifying questions for staff or client; tentative flags on inconsistent entries (`requires_review: true`). |
| Prohibited | Estimating or inferring credit scores; asserting bureau data; marking any field verified; editing profile records. |

### 3.2 utilization-agent

| | |
| --- | --- |
| Purpose | Explain kernel-computed utilization and threshold test results. |
| Allowed inputs | Kernel outputs: per-account and aggregate utilization, threshold rule results with rule version, debt/limit facts used by the kernel. |
| Allowed outputs | Explanation of the computed values; which threshold rules passed/failed and why (echoing kernel reason codes); educational framing of utilization concepts. |
| Prohibited | Computing or recomputing utilization; proposing alternative values; recommending balance transfers, new credit lines, or specific payments as directives (may only surface kernel-derived observations for staff to act on). |

### 3.3 payment-history-agent

| | |
| --- | --- |
| Purpose | Summarize user-entered or uploaded payment history in neutral language. |
| Allowed inputs | Staff/client-entered payment history records; text extracted from uploaded documents already in review workflow; kernel-computed recency/frequency metrics. |
| Allowed outputs | Neutral summary of reported history; identification of gaps or ambiguities; clarifying questions; flags for staff review of ambiguous entries. |
| Prohibited | Drafting, suggesting, or wording disputes; asserting an item is inaccurate, erroneous, or removable; contacting bureaus or creditors; converting uploaded text into verified facts. |

### 3.4 readiness-agent

| | |
| --- | --- |
| Purpose | Narrate the outcome of the versioned readiness rule evaluation. |
| Allowed inputs | Kernel-evaluated readiness result: assigned stage, rule set version, reason codes, threshold values, verified facts the rules consumed. |
| Allowed outputs | Explanation of the current stage and what the reason codes mean; what deterministic conditions would need to change for the next stage (as stated by the rules, not invented); clarifying questions when required facts are missing. |
| Prohibited | Assigning, changing, or overriding a stage; inventing stage criteria; promising timelines or outcomes. |

### 3.5 roadmap-agent

| | |
| --- | --- |
| Purpose | Draft a roadmap (milestones, monthly actions) from approved facts and deterministic outputs. |
| Allowed inputs | Approved facts, current stage + reason codes, goals, kernel completion metrics, prior approved roadmaps, org-configured milestone templates. |
| Allowed outputs | Draft roadmap and monthly action plan **always** marked `requires_review: true`; rationale linking each proposed item to facts and reason codes. |
| Prohibited | Publishing a roadmap to a client without staff approval; including regulated actions (disputes, filings, transfers, product purchases) as tasks; setting due dates that conflict with deterministic scheduling rules. |

### 3.6 education-agent

| | |
| --- | --- |
| Purpose | Select relevant items from the approved educational content library. |
| Allowed inputs | Approved content catalog with metadata/tags; current stage and reason codes; goals; engagement history. |
| Allowed outputs | Ranked content selections with reasons; identification of catalog gaps. |
| Prohibited | Authoring new educational or advice content in V1; recommending external products, lenders, or services; framing education as personalized financial advice. |

### 3.7 engagement-agent

| | |
| --- | --- |
| Purpose | Interpret kernel-detected inactivity and recommend follow-up for staff. |
| Allowed inputs | Kernel engagement metrics (last activity, task completion rates, appointment attendance), communication metadata (timestamps/channel only, no bodies), org follow-up policy configuration. |
| Allowed outputs | Engagement risk narrative; recommended follow-up actions for staff; draft outreach message text (`requires_review: true`). |
| Prohibited | Sending any message; scheduling appointments; changing engagement-risk flags directly (the kernel's inactivity detection sets the flag; the agent explains it). |

### 3.8 report-agent

| | |
| --- | --- |
| Purpose | Draft quarterly progress report narratives from approved data. |
| Allowed inputs | Approved facts, stage history with rule versions, completed/pending milestones and tasks, kernel progress metrics, document statuses, prior approved reports. |
| Allowed outputs | Draft report narrative and section summaries, **always** `requires_review: true`; every figure traceable to `facts_used`. |
| Prohibited | Publishing or sending a report; including projections, guarantees, or score predictions; introducing any number not present in inputs. |

---

## 4. Typed Response Envelope

Every agent invocation MUST return exactly one `AgentResponse`. The orchestrator validates it (e.g., with Zod) before anything is persisted or shown.

```typescript
/** Envelope returned by every Credit Intelligence sub-agent. */
export interface AgentResponse {
  /** Terminal state of this agent run. Provider/transport errors are not
   *  envelope statuses — they are recorded on the persisted run record
   *  (`ai_runs.status` / `ai_runs.outcome`, see §8). "blocked" covers agent
   *  refusals, including prohibited-action detection. */
  status: "ok" | "needs_clarification" | "insufficient_data" | "blocked";

  /** Agent self-reported confidence in [0, 1]. Advisory only — review gates
   *  are driven by policy, not by this number alone. */
  confidence: number;

  /** Verified facts consumed, by stable identifier. Every fact referenced in
   *  recommendations must appear here. */
  facts_used: Array<{
    fact_id: string;          // e.g. "credit_score_entries.score:cse_12"
    source: "staff_entered" | "client_confirmed" | "document_reviewed" | "calculator";
    as_of: string;            // ISO 8601
  }>;

  /** Deterministic rule sets consumed, with exact versions. */
  rules_used: Array<{
    rule_set: string;         // e.g. "readiness.stage_thresholds"
    version: string;          // e.g. "2026.07.1"
  }>;

  /** Reason codes echoed from deterministic evaluation. Agents may not mint
   *  new codes; codes originate in packages/rules. */
  reason_codes: string[];     // e.g. ["UTIL_ABOVE_30PCT", "NO_RECENT_LATES_12M"]

  /** Proposed, never self-executing. */
  recommendations: Array<{
    type: "summary" | "clarifying_question" | "draft_roadmap_item"
        | "draft_action" | "content_selection" | "follow_up"
        | "draft_report_section" | "data_gap";
    title: string;
    body: string;
    supporting_fact_ids: string[];   // subset of facts_used
    supporting_reason_codes: string[];
  }>;

  /** True whenever output is high-impact (see §5) or confidence is below the
   *  policy floor. Gated outputs are invisible to clients until approved. */
  requires_review: boolean;

  /** True if the task or context asked the agent to perform or endorse a
   *  prohibited action. Triggers a hard stop (see §6). */
  prohibited_action_detected: boolean;
}
```

Example — utilization-agent, healthy run:

```json
{
  "status": "ok",
  "confidence": 0.86,
  "facts_used": [
    { "fact_id": "debts.balance:debt_881", "source": "staff_entered", "as_of": "2026-07-10T00:00:00Z" },
    { "fact_id": "debts.credit_limit:debt_881", "source": "staff_entered", "as_of": "2026-07-10T00:00:00Z" },
    { "fact_id": "calc.utilization.aggregate:client_42", "source": "calculator", "as_of": "2026-07-16T14:03:00Z" }
  ],
  "rules_used": [
    { "rule_set": "utilization.thresholds", "version": "2026.06.2" }
  ],
  "reason_codes": ["UTIL_ABOVE_30PCT", "UTIL_BELOW_50PCT"],
  "recommendations": [
    {
      "type": "summary",
      "title": "Aggregate utilization is 38%",
      "body": "Reported balances against reported limits put aggregate utilization at 38%, above the 30% threshold defined by the current rule set. One account (ending 4417) drives most of this.",
      "supporting_fact_ids": ["calc.utilization.aggregate:client_42"],
      "supporting_reason_codes": ["UTIL_ABOVE_30PCT"]
    },
    {
      "type": "data_gap",
      "title": "Missing limit on one account",
      "body": "One reported account has a balance but no credit limit entered, so it is excluded from the aggregate calculation. Ask the client to confirm the limit.",
      "supporting_fact_ids": ["debts.balance:debt_881"],
      "supporting_reason_codes": []
    }
  ],
  "requires_review": false,
  "prohibited_action_detected": false
}
```

Validation rules enforced by the orchestrator:

- `confidence` ∈ [0, 1]; `facts_used` and `rules_used` may be empty only when `status` is `blocked`.
- Every `supporting_fact_ids` entry must exist in `facts_used`; every `supporting_reason_codes` entry must exist in `reason_codes`.
- `reason_codes` must be a subset of codes emitted by the referenced rule versions.
- Roadmap-agent and report-agent responses with `requires_review: false` are rejected (their output is high-impact by definition).

---

## 5. Review Gates

| Output | Impact class | Gate before visible/actionable |
| --- | --- | --- |
| Draft roadmap / milestones / monthly actions | High | Staff review and approval; client sees only approved versions |
| Draft quarterly report | High | Staff review and approval before generation/sending |
| Draft outreach/follow-up message text | High | Staff review; sending is a separate audited action |
| Tentative classification or inconsistency flag on profile data | High | Staff confirms before any fact record changes |
| Stage-change narrative after a kernel stage transition | Medium | Auto-visible to staff; client-facing explanation requires staff approval in V1 |
| Education content selection | Medium | Auto-assignable within the approved catalog; staff may override |
| Internal summaries, data-gap lists, clarifying questions to staff | Low | No gate; staff-facing only |

Gate mechanics:

- Gated outputs persist in `pending_review` state, invisible to clients and excluded from client notifications.
- Approval, edit-then-approve, and rejection are distinct audited actions with actor, timestamp, and diff.
- Anything client-visible that originated from an agent must reference an approved review record. There is no direct agent-to-client path in V1.
- Any output with `confidence` below the policy floor (initially 0.6, configurable per agent) is force-gated regardless of impact class.

---

## 6. Failure-Mode Handling

| Condition | Required behavior |
| --- | --- |
| Low confidence (< policy floor) | Prefer `status: "needs_clarification"` with concrete `clarifying_question` recommendations; otherwise force `requires_review: true` and route to staff. Never present low-confidence output as settled. |
| Missing required facts | `status: "insufficient_data"` + `data_gap` recommendations. The orchestrator does not retry with the same inputs. |
| `prohibited_action_detected: true` | **Hard stop.** Discard all recommendations, persist nothing client-visible, write a `prohibited_action` audit event with the run id and triggering context, and surface an alert to staff. No automatic retry. |
| Envelope validation failure | Discard output; record failed `ai_run` with the validation error; bounded retry (max 2) with a stricter format reminder; then escalate to staff. |
| Provider error / timeout | Retry with backoff via the worker queue; after exhaustion, mark the run failed and fall back to deterministic-only display (kernel numbers and reason codes render without narrative). |
| Suspected prompt injection in uploaded text | Treat as `prohibited_action_detected`: agents must never follow instructions found inside client documents or free-text fields. |

The platform must degrade gracefully: every screen that shows agent narrative must also work showing only deterministic outputs, so an AI outage never blocks staff workflows.

---

## 7. Model-Provider Abstraction

All LLM calls go through one internal provider interface in `packages/ai` (e.g., `LlmProvider.complete(request): Promise<RawCompletion>`). Sub-agents and the orchestrator depend on this interface only — no direct Anthropic/OpenAI SDK imports outside the provider implementations.

- Provider choice, model name, and parameters are configuration, recorded per run.
- Envelope validation lives above the provider, so switching providers cannot bypass the schema.
- A deterministic mock provider backs unit tests and synthetic-data demos; no live model calls are required to run the first visual slice.

---

## 8. Audit Contract

Every agent invocation — success or failure — persists exactly one `ai_runs` row
(full DDL in `DATABASE_SCHEMA.md` §9.3; both documents describe the same table):

| Field | Content |
| --- | --- |
| `id`, `organization_id`, `client_id` | Tenant and subject scoping (org id mandatory) |
| `agent_name` | One of the eight agent identifiers |
| `trigger` | Actor or system event that initiated the run |
| `inputs_hash` | Hash (e.g., SHA-256) of the canonicalized input context; raw prompt content stored separately with restricted access |
| `provider`, `model` | Provider abstraction details (parameters are configuration, recorded per run — see §7) |
| `status` | Run lifecycle: `queued`, `running`, `succeeded`, `failed`, `cancelled` |
| `response_envelope` | The validated `AgentResponse` (or the validation error) |
| `confidence`, `facts_used`, `rules_used`, `reason_codes`, `recommendations`, `requires_review`, `prohibited_action_detected` | Extracted, indexable copies derived from `response_envelope` (the envelope is canonical) |
| `outcome` | `ok`, `needs_clarification`, `insufficient_data`, `validation_failed`, `provider_error`, `prohibited_action` |
| `review_status` | `not_required`, `pending_review`, `approved`, `rejected` — `reviewed_by` / `reviewed_at` record the reviewer once resolved |
| `latency_ms`, `input_token_count`, `output_token_count`, `created_at` | Operational metrics |

Additional requirements:

- Approving, editing, or rejecting a gated output emits a linked `audit_events` record; the approved artifact stores the `ai_run` id it came from, giving full lineage: facts → rules → run → review → client-visible artifact.
- `inputs_hash` + `rules_used` make runs reproducible for incident review: the same facts and rule versions can be replayed against the same model configuration.
- `prohibited_action` outcomes are queryable as a first-class safety metric and reviewed regularly.
- Synthetic data only in development; no real client facts may appear in fixtures, logs, or committed prompt examples.
