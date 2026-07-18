# ADR-0003: Deterministic Core, AI Shell

## Status

Accepted — 2026-07-17

## Context

AFLO makes financial-readiness determinations (lifecycle stages, utilization thresholds, readiness rules) for real coaching clients. The execution brief is explicit: separate deterministic financial logic from probabilistic AI output; AI may draft, explain, summarize, classify tentatively, and ask clarifying questions, but may **not** alter financial facts, approve loans, select investments, make legal dispute decisions, determine final tax treatment, or execute transfers. Lifecycle stages "are determined by versioned rules, not free-form LLM decisions."

The business plan's isolation-boundary protocol prescribes the same architecture for the long-term platform: a **probabilistic AI context shell** that parses, enriches, and flags for review, strictly separated from a **deterministic logic kernel** that executes all financial math in unit-tested code "completely independent of LLM parameters," and alone writes ledger and audit entries. Adopting the same boundary in V1 keeps Golden Key Wealth compatible with that future without building it now.

The stakes are asymmetric: an awkward AI-drafted summary is an annoyance; a hallucinated stage assignment, utilization figure, or implied credit-repair action is a compliance and trust failure.

## Decision

Split all client-affecting logic into two layers with a typed boundary between them.

### Deterministic core (`packages/rules`, future)

- A **versioned rules engine** owns lifecycle stage determination (Recovery → Legacy), utilization and debt-ratio calculations, threshold tests, completion metrics, and readiness gates.
- Rules are pure, unit-tested functions over verified facts. Every evaluation records the rule version and emits machine-readable **reason codes**.
- Rule changes ship as new versions; past assessments remain reproducible against the version that produced them (auditability requirement).
- Only application services downstream of this core may mutate financial facts, and every material state change writes an audit event.

### AI shell (`packages/ai`, future)

- LLM calls sit behind an internal provider interface (Claude or OpenAI is an implementation detail).
- The twelve credit-intelligence sub-agents (intake-completeness, credit-profile, utilization, payment-history, debt-obligation, readiness-stage, roadmap, education, engagement, report, partner-routing, compliance-guard) are **logical roles behind one orchestration service**, not independently privileged services. They consume deterministic outputs and verified facts; they never compute financial figures themselves. The compliance-guard agent runs last over the others' proposed outputs. (Full roster and boundaries: `docs/architecture/AGENT_BOUNDARIES.md`.)
- Every agent response is a typed envelope (canonical definition:
  `packages/ai/src/envelope.ts`):

```typescript
interface AgentEnvelope {
  id: string;                              // ai_runs.id
  agentName: AgentName;                    // one of the twelve sub-agents
  agentVersion: string;                    // version of the agent implementation
  organizationId: string;
  clientId: string;
  status: "ok" | "needs_clarification" | "insufficient_data" | "blocked";
  confidence: number;                      // 0..1
  factsUsed: string[];                     // identifiers of verified inputs only
  missingFacts: string[];                  // facts needed but absent → clarification
  ruleVersionsUsed: string[];              // versioned deterministic rules consulted
  reasonCodes: string[];                   // echoed from deterministic evaluation
  proposedActions: ProposedAction[];       // proposals, never mutations
  prohibitedActionsDetected: string[];     // non-empty → hard stop (compliance-guard)
  requiresHumanReview: boolean;
  reviewStatus: ReviewStatus;              // pending_review | approved | rejected | auto_published
  createdAt: string;                       // ISO datetime
}
```

  `blocked` covers agent refusals; a non-empty `prohibitedActionsDetected` forces
  `blocked` and hard-stops the run. Provider/transport errors are not envelope
  statuses — they are captured on the persisted run record (`ai_runs.status` /
  `ai_runs.outcome`).

- Envelopes are validated at runtime (schema parsing); malformed output, or any run with a non-empty `prohibitedActionsDetected`, is quarantined, never surfaced.
- **Review gates:** high-impact output (`requiresHumanReview: true`) is held until Golden Key staff review or explicit client approval; approvals are recorded as audit events. AI output has no write path to financial facts — proposals become state only through application services that check permissions, rule versions, and review status.

### Prohibited for AI in any layer

Altering financial facts, assigning lifecycle stages, approving loans, selecting investments, deciding credit disputes, determining tax treatment, executing or initiating transfers.

## Consequences

Positive:

- Financial determinations are reproducible, testable, and explainable via reason codes — no "the model said so."
- Provider/model swaps cannot change client stages or calculations.
- The review gate plus audit trail satisfies the brief's governance rules and keeps V1 clear of regulated-activity postures (credit repair, tax opinions, advisory) the business plan explicitly avoids.
- V1 lands on the same isolation boundary the long-term protocol requires, so later phases extend rather than rework it.

Negative / accepted costs:

- Two layers plus an envelope schema is more upfront structure than "call the LLM from the route handler"; simple features pay a small tax.
- Versioned rules require migration discipline (re-assessment policy when rules change).
- The review gate adds staff workload; engagement/education output with low impact may be auto-approved by policy, but that policy itself must be explicit and audited.

## Alternatives Considered

1. **LLM-driven stage and readiness decisions with prompt guardrails.** Rejected: non-reproducible, non-auditable, and directly violates the brief; prompts are not a compliance boundary.
2. **No AI in V1 at all.** Rejected: drafting roadmaps, summaries, and quarterly reports is exactly the low-risk, high-leverage work AI is permitted to do, and the orchestration boundary is cheap to build against mock providers now.
3. **Independently privileged agent services (one deployable per agent).** Rejected: contradicts ADR-0001 and multiplies the surface where a prohibited action could execute; a single orchestration service with typed envelopes is easier to gate and audit.
