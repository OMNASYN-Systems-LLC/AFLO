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
  PlaybookContent,
  PlaybookVersionStatus,
  ReasonCode,
  ReviewArtifactType,
  ReviewDecision,
  ReviewItemState,
  ReviewReasonCode,
  ReviewRiskClass,
  ReviewerRole,
  RoadmapStatus,
  WorkflowDiscoveryStatus,
} from "@aflo/rules";
import type {
  NeutralityRecord,
  PartnerReferralStatus,
  ReferralOutcome,
} from "@aflo/partner-marketplace";

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
  /**
   * Founder decision 2026-07-23 #2: whether this tenant permits the DOCUMENTED
   * single-operator owner override of the playbook author/approver separation
   * rules (reason recorded, audited, not regulated advice, visible in review
   * history). Default FALSE — including the Golden Key seed.
   */
  allowSingleOperatorPlaybookOverride: boolean;
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
 * A tracked referral to a licensed external partner (partner.v1.0.0). AFLO
 * routes and records — it never approves a loan or guarantees acceptance. The
 * neutrality record (ADR-0007 §3) is captured at creation and is immutable
 * thereafter; the store refuses to create a referral without a complete one.
 * `outcome` is a staff observation set at `outcome_recorded`, never an
 * approval. Partner compensation never touches readiness.
 */
export interface PartnerReferral {
  id: string;
  organizationId: string;
  clientId: string;
  partnerId: string;
  status: PartnerReferralStatus;
  /** The eight-field neutrality disclosure captured when the referral was made. */
  neutrality: NeutralityRecord;
  /** Staff-observed result, set only at outcome_recorded; null before then. */
  outcome: ReferralOutcome | null;
  outcomeNote: string | null;
  createdByStaffId: string;
  createdAt: string; // ISO datetime
  sharedAt: string | null; // ISO datetime once shared with the client
  updatedAt: string; // ISO datetime
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

// ============================================================================
// Human Review Center + Professional Playbooks (Workstream A PR-5, ADR-0043)
//
// Mirrors migrations 0009 + 0010 field-for-field (camelCase, ISO strings) so
// the mock store can be swapped for the Drizzle repositories behind the same
// shapes. A ReviewItem REFERENCES its artifact — id + version + sha256 digest
// ONLY, never the artifact body (coordination layer, not a second system of
// record). Member-id columns surface as staff ids in the prototype store.
// ============================================================================

/** A source-fact reference: identifier + freshness timestamp ONLY, never a value. */
export interface SourceFactSnapshot {
  factId: string;
  asOf: string; // ISO datetime
}

/** One recorded field modification — sha256 digests only, never content. */
export interface ModificationDigest {
  field: string;
  beforeSha256: string;
  afterSha256: string;
}

/** Outcome-tracking vocabulary (founder: measurable outcomes). */
export type ClientActionStatus = "pending" | "completed" | "not_completed";
export type ReviewOutcome = "achieved" | "not_achieved" | "unknown";

/**
 * A Human Review Center queue item (review_center.v1.0.0). State moves only
 * through the kernel; publication additionally requires the stale-artifact
 * check (stored artifactVersion + artifactDigest must match the artifact's
 * CURRENT version + digest) and the founder-matrix publication role floor.
 */
export interface ReviewItem {
  id: string;
  organizationId: string;
  /** Null for org-level artifacts. */
  clientId: string | null;
  artifactType: ReviewArtifactType;
  artifactId: string;
  /** The reviewed artifact version — a new artifact version requires a new review. */
  artifactVersion: string;
  /** sha256 hex digest of the reviewed artifact content (64 lowercase hex). */
  artifactDigest: string;
  /** The founder 5-tuple's workflow dimension; usually equals artifactType. */
  workflowType: ReviewArtifactType;
  sourceFactSnapshots: SourceFactSnapshot[];
  ruleVersionsUsed: string[];
  /** Provenance for AI-drafted artifacts (null = manually authored). */
  aiRunId: string | null;
  aiModel: string | null;
  aiPromptVersion: string | null;
  /** Numeric string ("0.850") or null for deterministic/manual artifacts. */
  confidence: string | null;
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
  state: ReviewItemState;
  assignedReviewerStaffId: string | null;
  reviewedByStaffId: string | null;
  reviewedAt: string | null;
  latestDecision: ReviewDecision | null;
  latestDecisionReasonCode: string | null;
  modificationsDigest: ModificationDigest[];
  /** Pointer/digest of the published artifact version — never the body. */
  publishedResultRef: string | null;
  publishedAt: string | null;
  playbookId: string | null;
  playbookVersion: string | null;
  previousReviewItemId: string | null;
  supersededByReviewItemId: string | null;
  clientActionRef: string | null;
  clientActionStatus: ClientActionStatus | null;
  outcome: ReviewOutcome | null;
  outcomeRecordedAt: string | null;
  /** Null = orchestrator/system-created. */
  createdByStaffId: string | null;
  /** Review-time metric anchor — stamped ONLY on the FIRST entry into awaiting_review. */
  submittedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One structured review decision — APPEND-ONLY (the feedback record the moat
 * depends on; digests and field NAMES only, never content). Data governance
 * (founder directive 2026-07-20): used ONLY for analytics, rule improvement,
 * prompt improvement, workflow improvement, and QA — never for uncontrolled
 * model training.
 */
export interface ReviewDecisionRecord {
  id: string;
  organizationId: string;
  reviewItemId: string;
  decision: ReviewDecision;
  /** Structured RVD_* code from REVIEW_DECISION_REASON_CODES. */
  reasonCode: string;
  ruleVersion: string;
  decidedByStaffId: string;
  clientStageAtDecision: LifecycleStage | null;
  workflowType: ReviewArtifactType;
  aiRunId: string | null;
  agentVersion: string | null;
  /** Edited field NAMES only — never values. */
  editedFields: string[];
  /** sha256 hex digest of the final approved output — digest only. */
  finalOutputSha256: string | null;
  escalatedToRole: ReviewerRole | null;
  detail: string | null;
  decidedAt: string;
}

/** Playbook identity; content lives in versions. currentVersionId = latest PUBLISHED version. */
export interface Playbook {
  id: string;
  organizationId: string;
  playbookKey: string;
  name: string;
  currentVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}

/**
 * One review-history entry on a playbook version (append-only). The founder's
 * owner-override decision requires the override to be VISIBLE in review
 * history — `ownerOverride` carries the recorded reason whenever the entry
 * was allowed through the documented single-operator override.
 */
export interface PlaybookVersionReviewEvent {
  action: "saved" | "submitted" | "approved" | "rejected" | "deferred" | "published" | "withdrawn" | "superseded";
  actorStaffId: string;
  reasonCode: string;
  occurredAt: string;
  ownerOverride: { reason: string } | null;
}

/** A playbook version — versioned tenant IP under the unified review vocabulary. */
export interface PlaybookVersion {
  id: string;
  organizationId: string;
  playbookId: string;
  /** Plain semver, e.g. "1.0.0". */
  version: string;
  status: PlaybookVersionStatus;
  effectiveDate: string | null;
  authorStaffId: string;
  approverStaffId: string | null;
  approvedAt: string | null;
  content: PlaybookContent;
  /** Append-only review history (incl. any recorded owner override). */
  reviewHistory: PlaybookVersionReviewEvent[];
  createdAt: string;
  updatedAt: string;
}

/** A workflow-discovery queue item — the anti-invention question list. */
export interface WorkflowDiscoveryItem {
  id: string;
  organizationId: string;
  playbookId: string | null;
  checkpointRef: string | null;
  question: string;
  context: string;
  status: WorkflowDiscoveryStatus;
  /** Null = system/seed-raised. */
  raisedByStaffId: string | null;
  answer: string | null;
  answeredByStaffId: string | null;
  answeredAt: string | null;
  convertedPlaybookVersionId: string | null;
  createdAt: string;
  updatedAt: string;
}
