/**
 * Typed envelope for every Credit Intelligence Engine sub-agent response.
 *
 * Contract (CLAUDE.md + docs/architecture/AGENT_BOUNDARIES.md): agents may
 * propose, explain, and ask — they may not mutate financial facts, pick
 * lifecycle stages, or execute regulated actions. High-impact output is
 * gated behind staff review or explicit client approval.
 */

export const AGENT_NAMES = [
  "credit-profile-agent",
  "utilization-agent",
  "payment-history-agent",
  "readiness-agent",
  "roadmap-agent",
  "education-agent",
  "engagement-agent",
  "report-agent",
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

export interface AgentRecommendation {
  id: string;
  summary: string;
  rationale: string;
  impact: "low" | "medium" | "high";
}

export interface AgentEnvelope {
  /** Stable identifier for the run that produced this envelope (ai_runs.id). */
  id: string;
  agent: AgentName;
  status: AgentStatus;
  /** Model self-estimate in [0,1]; deterministic facts are never "confident" — they are facts. */
  confidence: number;
  /** Identifiers of verified facts the agent was given (e.g. "credit_profile.score"). */
  factsUsed: string[];
  /** Versioned deterministic rules consulted (e.g. "readiness.v1.0.0"). */
  rulesUsed: string[];
  /** Reason codes emitted by deterministic calculators, echoed for traceability. */
  reasonCodes: string[];
  recommendations: AgentRecommendation[];
  requiresReview: boolean;
  prohibitedActionDetected: boolean;
  reviewStatus: ReviewStatus;
  createdAt: string; // ISO datetime
}
