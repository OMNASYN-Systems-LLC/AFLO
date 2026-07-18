/**
 * Typed envelope for every Credit Intelligence Engine agent response,
 * matching the Product Charter's agent output contract exactly.
 *
 * Contract (PRODUCT_CHARTER.md, "Credit Intelligence Engine"): agents may
 * propose, explain, and ask — they may not mutate financial facts, pick
 * lifecycle stages, or execute regulated actions. High-impact output is
 * gated behind staff review or explicit client approval. The Compliance
 * Guard Agent evaluates proposed outputs last and any detected prohibited
 * action hard-stops the run.
 */

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
