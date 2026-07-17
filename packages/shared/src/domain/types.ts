/**
 * AFLO V1 domain model — Golden Key Wealth.
 *
 * These types back the first visual slice with synthetic data only.
 * They mirror the proposed Neon schema (docs/architecture/DATABASE_SCHEMA.md)
 * so mock repositories can later be swapped for Neon-backed implementations
 * behind the same interfaces (ADR-0002).
 */

/** The eight AFLO financial lifecycle stages, in order. Stage selection is
 * always the output of versioned deterministic rules — never an LLM. */
export const LIFECYCLE_STAGES = [
  "recovery",
  "stabilization",
  "credit_readiness",
  "capital_readiness",
  "acquisition",
  "maintenance",
  "growth",
  "legacy",
] as const;

export type LifecycleStage = (typeof LIFECYCLE_STAGES)[number];

export type ClientKind = "lead" | "client";

export type PipelineStatus =
  | "new_lead"
  | "contacted"
  | "consult_scheduled"
  | "onboarding"
  | "active"
  | "paused";

export type EngagementStatus = "active" | "cooling" | "at_risk" | "dormant";

export type DocumentReviewStatus =
  | "requested"
  | "uploaded"
  | "in_review"
  | "approved"
  | "needs_attention";

export type ActionStatus = "todo" | "in_progress" | "done";

export type MilestoneStatus = "upcoming" | "in_progress" | "completed";

export type ReportStatus = "draft" | "ready_for_review" | "published";

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface StaffMember {
  id: string;
  organizationId: string;
  name: string;
  role: "organization_owner" | "staff";
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
  pipelineStatus: PipelineStatus;
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  assignedStaffId: string;
  joinedAt: string; // ISO date
  lastActivityAt: string; // ISO date — drives engagement rules
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

export interface AdminNote {
  id: string;
  clientId: string;
  staffId: string;
  body: string;
  createdAt: string; // ISO datetime
}
