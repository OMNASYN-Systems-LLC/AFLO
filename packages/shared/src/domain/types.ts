/**
 * AFLO V1 domain model — Golden Key Wealth.
 *
 * These types back the first visual slice with synthetic data only.
 * They mirror the proposed Neon schema (docs/architecture/DATABASE_SCHEMA.md)
 * so mock repositories can later be swapped for Neon-backed implementations
 * behind the same interfaces (ADR-0002).
 */

import type {
  EngagementStatus,
  LifecycleStage,
  ReasonCode,
  ReviewReasonCode,
  RoadmapStatus,
} from "@aflo/rules";

// Lifecycle stages and engagement statuses are versioned domain
// configuration owned by the rules kernel (@aflo/rules); re-exported here
// so the domain model presents one import surface.
export { LIFECYCLE_STAGES } from "@aflo/rules";
export type { EngagementStatus, LifecycleStage };

export type ClientKind = "lead" | "client";

/** Post-activation client lifecycle status; null while still a lead. */
export type ClientStatus = "active" | "paused";

export type DocumentReviewStatus =
  | "requested"
  | "uploaded"
  | "in_review"
  | "approved"
  | "needs_attention";

export type ActionStatus = "todo" | "in_progress" | "done";

export type MilestoneStatus = "upcoming" | "in_progress" | "completed";

/**
 * A client roadmap moving through the founder-required approval workflow
 * (@aflo/rules roadmap.v1.0.0: Draft → Staff Review → Approved → Published).
 * Status changes only via the workflow rules — never assigned free-form.
 * AI may draft language (aiRunId provenance); humans submit, approve, and
 * publish.
 */
export interface Roadmap {
  id: string;
  clientId: string;
  title: string;
  status: RoadmapStatus;
  stageAtCreation: LifecycleStage;
  /** ai_runs provenance when the draft language came from the roadmap-agent; null = manually authored. */
  aiRunId: string | null;
  createdByStaffId: string;
  approvedByStaffId: string | null;
  approvedAt: string | null; // ISO datetime
  publishedAt: string | null; // ISO datetime
  createdAt: string; // ISO datetime
}

export type ReportStatus = "draft" | "ready_for_review" | "published";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

/** Organization member roles (charter: Owner, Admin, Advisor/Staff). Platform
 * Admin is a platform-level flag, never a membership; Client and Partner
 * Viewer principals are modeled separately when their slices land. */
export type MemberRole = "organization_owner" | "organization_admin" | "staff";

export interface StaffMember {
  id: string;
  organizationId: string;
  name: string;
  role: MemberRole;
  title: string;
}

/** Canonical display name — every surface renders people through this. */
export function fullName(person: { firstName: string; lastName: string }): string {
  return `${person.firstName} ${person.lastName}`;
}

export interface ClientRecord {
  id: string;
  organizationId: string;
  kind: ClientKind;
  /** Stage id from the organization's configurable pipeline definition
   * (@aflo/rules PipelineDefinition). Transitions only via pipeline rules —
   * never assigned free-form. Activated clients sit at the terminal stage. */
  pipelineStageId: string;
  /** Post-activation lifecycle status; null while kind === "lead". */
  clientStatus: ClientStatus | null;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  assignedStaffId: string;
  joinedAt: string; // ISO date
  lastActivityAt: string; // ISO date — drives engagement rules
}

/**
 * A recorded readiness assessment — the workflow fact produced when staff
 * (or later a scheduled job) runs the deterministic readiness rules over the
 * client's verified profiles. Records are append-only history; the latest
 * one is the client's standing assessment. An attempt that cannot run
 * (missing profiles) is audited, never recorded.
 */
export interface ReadinessAssessmentRecord {
  id: string;
  clientId: string;
  stage: LifecycleStage;
  /** Stage of the previous recorded assessment; null for the first. */
  previousStage: LifecycleStage | null;
  ruleVersion: string;
  reasonCodes: ReasonCode[];
  factsUsed: string[];
  /** Deterministic proposal selected by the binding blocker (first reason code). */
  proposedNextAction: string;
  /** Set by the deterministic review gate (review.v1.0.0), never by AI. */
  requiresHumanReview: boolean;
  reviewReasonCodes: ReviewReasonCode[];
  assessedAt: string; // ISO datetime
  /** Null when a scheduled job (worker) ran the assessment. */
  actorStaffId: string | null;
}

/**
 * An education assignment from the ΛFLO Wealth Academy. Records full
 * provenance: the source trigger, the deterministic rule version + reason
 * code, and the exact content version the client was given. Completion is
 * educational only — it never gates any regulated product.
 */
export interface EducationAssignment {
  id: string;
  clientId: string;
  lessonId: string;
  contentVersion: string;
  trigger: string;
  reasonCode: string;
  ruleVersion: string;
  assignedAt: string; // ISO datetime
  completedAt: string | null;
  knowledgeCheckScore: number | null; // fraction 0..1, or null if no check
  staffReviewStatus: "not_required" | "pending_review" | "approved";
}

export type IntakeStatus = "in_progress" | "completed";

/**
 * Structured-intake progress for one client/lead. Section ids reference the
 * organization's intake definition (@aflo/rules IntakeDefinition); the data
 * each section gathers lives in the domain records it feeds (financial
 * profile, credit profile, goals, documents…), never here. Completion is
 * only ever decided by the intake rules.
 */
export interface IntakeRecord {
  id: string;
  clientId: string;
  status: IntakeStatus;
  completedSectionIds: string[];
  startedAt: string; // ISO datetime
  completedAt: string | null; // ISO datetime once the rules declared it complete
}

/** Self- or staff-reported financial facts. Synthetic in V1 slice. */
export interface FinancialProfile {
  clientId: string;
  monthlyIncomeCents: number;
  monthlyDebtPaymentsCents: number;
  liquidSavingsCents: number;
  monthlyEssentialExpensesCents: number;
  incomeStability: "stable" | "variable" | "unstable";
}

/** Manual score entry + uploaded report only in V1 — no bureau pulls. */
export interface CreditProfile {
  clientId: string;
  score: number | null;
  scoreSource: "manual_entry" | "uploaded_report";
  scoreAsOf: string | null; // ISO date
  revolvingBalanceCents: number;
  revolvingLimitCents: number;
  openTradelines: number;
  derogatoryMarks: number;
  onTimePaymentRate: number; // 0..1 over trailing 24 months
}

export interface Goal {
  id: string;
  clientId: string;
  title: string;
  category:
    | "credit"
    | "savings"
    | "debt"
    | "home_purchase"
    | "business_capital"
    | "other";
  targetDate: string; // ISO date
  progressPct: number; // 0..100, staff-maintained
  isPrimary: boolean;
}

export interface RoadmapMilestone {
  id: string;
  clientId: string;
  roadmapId: string;
  order: number;
  title: string;
  description: string;
  status: MilestoneStatus;
  targetMonth: string; // e.g. "2026-09"
}

export interface MonthlyAction {
  id: string;
  clientId: string;
  month: string; // e.g. "2026-07"
  title: string;
  category: "payment" | "savings" | "documentation" | "education" | "habit";
  status: ActionStatus;
  dueDate: string; // ISO date
}

export interface ClientDocument {
  id: string;
  clientId: string;
  name: string;
  docType:
    | "credit_report"
    | "income_verification"
    | "bank_statement"
    | "identification"
    | "other";
  reviewStatus: DocumentReviewStatus;
  updatedAt: string; // ISO date
}

export interface Appointment {
  id: string;
  clientId: string;
  staffId: string;
  purpose: string;
  scheduledAt: string; // ISO datetime
  channel: "video" | "phone" | "in_person";
}

export interface QuarterlyReport {
  id: string;
  clientId: string;
  quarter: string; // e.g. "2026-Q2"
  status: ReportStatus;
  stageAtGeneration: LifecycleStage;
  highlights: string[];
  focusForNextQuarter: string;
  generatedAt: string; // ISO date
}

/**
 * Round-up simulator configuration for one client. SIMULATION ONLY — this
 * never moves money or links to a real account (charter). Amounts are cents.
 */
export interface SimulationSettings {
  clientId: string;
  roundToCents: number; // e.g. 100 = nearest dollar
  multiplier: number; // e.g. 2 = double round-ups
  enabled: boolean;
}

/**
 * A hypothetical transaction used to visualize round-up saving behavior.
 * Synthetic or user-entered; never a real purchase. `roundUpAmountCents` is
 * the deterministic calculator output (roundup.v1.0.0).
 */
export interface VirtualTransaction {
  id: string;
  clientId: string;
  label: string;
  amountCents: number;
  roundUpAmountCents: number;
  occurredOn: string; // ISO date
}

export interface AdminNote {
  id: string;
  clientId: string;
  staffId: string;
  body: string;
  createdAt: string; // ISO datetime
}
