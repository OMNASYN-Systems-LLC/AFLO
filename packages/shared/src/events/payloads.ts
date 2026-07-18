import type { LifecycleStage } from "@aflo/rules";
import type { ReviewStatus } from "@aflo/ai";
import type { EventType } from "./catalog";

/**
 * Per-event payload contracts (version 1 of each type).
 *
 * Payloads carry domain deltas only. Tenancy, aggregate identity, actor,
 * timing, and causality live on the envelope — never duplicated here except
 * where a payload genuinely references *other* records (e.g. clientId on a
 * task event whose aggregate is the task).
 *
 * Pipeline/status identifiers are strings referencing configurable
 * organization settings (charter: configurable pipeline stages), not enums.
 */

export interface LeadCreatedPayload {
  leadId: string;
  pipelineStatus: string;
  source: string | null;
}

export interface LeadStatusChangedPayload {
  leadId: string;
  fromStatus: string;
  toStatus: string;
  /** Reason code from the deterministic pipeline rules, e.g. "PL_OK". */
  reasonCode: string;
}

export interface IntakeStartedPayload {
  clientId: string;
  leadId: string | null;
  intakeId: string;
}

export interface IntakeCompletedPayload {
  clientId: string;
  intakeId: string;
  /** Deterministic completeness result: sections present vs required. */
  completedSections: string[];
  missingSections: string[];
}

export interface ClientActivatedPayload {
  clientId: string;
  convertedFromLeadId: string | null;
  assignedStaffId: string;
}

export interface FinancialProfileUpdatedPayload {
  clientId: string;
  /** Field names that changed — values live in the profile record, not the event. */
  changedFields: string[];
}

export interface CreditProfileUpdatedPayload {
  clientId: string;
  changedFields: string[];
  scoreSource: "manual_entry" | "uploaded_report" | null;
}

export interface GoalCreatedPayload {
  clientId: string;
  goalId: string;
  category: string;
  isPrimary: boolean;
}

export interface ReadinessAssessedPayload {
  clientId: string;
  assessmentId: string;
  stage: LifecycleStage;
  previousStage: LifecycleStage | null;
  ruleVersion: string;
  reasonCodes: string[];
  requiresHumanReview: boolean;
}

export interface RoadmapDraftedPayload {
  clientId: string;
  roadmapId: string;
  /** Non-null when the draft language came from the roadmap-agent (ai_runs.id). */
  aiRunId: string | null;
  milestoneCount: number;
}

export interface RoadmapApprovedPayload {
  clientId: string;
  roadmapId: string;
  approvedByMemberId: string;
  publishedToClient: boolean;
}

export interface MilestoneActivatedPayload {
  clientId: string;
  roadmapId: string;
  milestoneId: string;
  /** Deterministic eligibility rule that activated it, with reason codes. */
  ruleVersion: string;
  reasonCodes: string[];
}

export interface TaskAssignedPayload {
  clientId: string;
  taskId: string;
  milestoneId: string | null;
  templateId: string | null;
  dueDate: string; // ISO date
}

export interface TaskCompletedPayload {
  clientId: string;
  taskId: string;
  completedBy: "client" | "staff";
  verifiedByMemberId: string | null;
  evidenceDocumentId: string | null;
}

export interface DocumentRequestedPayload {
  clientId: string;
  documentId: string;
  docType: string;
  dueDate: string | null;
}

export interface DocumentUploadedPayload {
  clientId: string;
  documentId: string;
  docType: string;
  /** Storage object reference — never file contents. */
  storageRef: string;
}

export interface DocumentReviewedPayload {
  clientId: string;
  documentId: string;
  reviewStatus: string;
  reviewedByMemberId: string;
}

export interface AppointmentScheduledPayload {
  clientId: string;
  appointmentId: string;
  staffMemberId: string;
  scheduledAt: string; // ISO datetime
  channel: string;
}

export interface EngagementRiskDetectedPayload {
  clientId: string;
  engagementStatus: string;
  daysSinceLastActivity: number;
  ruleVersion: string;
}

export interface ProgressReportGeneratedPayload {
  clientId: string;
  reportId: string;
  quarter: string;
  reviewStatus: ReviewStatus;
  aiRunId: string | null;
}

export interface EducationAssignedPayload {
  clientId: string;
  assignmentId: string;
  moduleId: string;
  /** What triggered the assignment: stage, task, or a named fact trigger. */
  trigger: string;
}

export interface EducationCompletedPayload {
  clientId: string;
  assignmentId: string;
  moduleId: string;
  knowledgeCheckScore: number | null;
}

export interface PartnerReferralCreatedPayload {
  clientId: string;
  referralId: string;
  partnerId: string;
  /** Partner Neutrality Engine record id documenting why this option was shown. */
  neutralityRecordId: string;
}

export interface ConsentGrantedPayload {
  clientId: string;
  consentId: string;
  consentType: string;
  scope: string;
}

export interface ConsentRevokedPayload {
  clientId: string;
  consentId: string;
  consentType: string;
  /** Revocation must reference the grant it revokes. */
  revokesConsentEventId: string;
}

/** Compile-time map from event type to payload shape (exhaustive). */
export interface EventPayloadMap {
  LeadCreated: LeadCreatedPayload;
  LeadStatusChanged: LeadStatusChangedPayload;
  IntakeStarted: IntakeStartedPayload;
  IntakeCompleted: IntakeCompletedPayload;
  ClientActivated: ClientActivatedPayload;
  FinancialProfileUpdated: FinancialProfileUpdatedPayload;
  CreditProfileUpdated: CreditProfileUpdatedPayload;
  GoalCreated: GoalCreatedPayload;
  ReadinessAssessed: ReadinessAssessedPayload;
  RoadmapDrafted: RoadmapDraftedPayload;
  RoadmapApproved: RoadmapApprovedPayload;
  MilestoneActivated: MilestoneActivatedPayload;
  TaskAssigned: TaskAssignedPayload;
  TaskCompleted: TaskCompletedPayload;
  DocumentRequested: DocumentRequestedPayload;
  DocumentUploaded: DocumentUploadedPayload;
  DocumentReviewed: DocumentReviewedPayload;
  AppointmentScheduled: AppointmentScheduledPayload;
  EngagementRiskDetected: EngagementRiskDetectedPayload;
  ProgressReportGenerated: ProgressReportGeneratedPayload;
  EducationAssigned: EducationAssignedPayload;
  EducationCompleted: EducationCompletedPayload;
  PartnerReferralCreated: PartnerReferralCreatedPayload;
  ConsentGranted: ConsentGrantedPayload;
  ConsentRevoked: ConsentRevokedPayload;
}

// Exhaustiveness guarantee: if EventPayloadMap ever misses an EventType (or
// gains an unknown key), these assignments stop compiling. Tuple wrapping
// prevents distributive-conditional false positives.
type _AssertCovers = [EventType] extends [keyof EventPayloadMap] ? true : never;
type _AssertNoExtra = [keyof EventPayloadMap] extends [EventType] ? true : never;
const _covers: _AssertCovers = true;
const _noExtra: _AssertNoExtra = true;
void _covers;
void _noExtra;
