import type {
  LifecycleStage,
  ReviewArtifactType,
  ReviewDecision,
  ReviewItemState,
  ReviewRiskClass,
  ReviewerRole,
  WorkflowDiscoveryStatus,
} from "@aflo/rules";
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

export interface IntakeSectionCompletedPayload {
  clientId: string;
  intakeId: string;
  /** Section id from the organization's intake definition. */
  sectionId: string;
  /** Deterministic progress after this completion (intake.completeness). */
  completedRequiredCount: number;
  requiredCount: number;
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

export interface RoadmapPublishedPayload {
  clientId: string;
  roadmapId: string;
  publishedByMemberId: string;
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

export interface ProgressReportPublishedPayload {
  clientId: string;
  reportId: string;
  quarter: string;
  publishedByMemberId: string;
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

/**
 * A message was posted to a conversation thread. Deliberately carries NO body —
 * downstream consumers (e.g. a "new message" notification) key on ids and the
 * sender role, never the content, so sensitive text never lands in the outbox.
 */
export interface MessagePostedPayload {
  threadId: string;
  messageId: string;
  clientId: string;
  senderRole: "staff" | "client";
}

/**
 * A thread's messages from the OTHER side were marked read. Carries counts and
 * roles only — never a body — so read receipts stay free of sensitive content.
 */
export interface MessageReadPayload {
  threadId: string;
  clientId: string;
  /** Who did the reading (their counterpart's messages became read). */
  readerRole: "staff" | "client";
  /** How many previously-unread messages this transitioned to read (>= 1). */
  messageCount: number;
}

// --- Human Review Center + Playbooks + Workflow Discovery (A PR-5) ----------
// Every payload here carries IDS, DIGESTS, AND REASON CODES ONLY — never an
// artifact body, edited content, or answer text. Domain records stay the
// source of truth; the outbox stays free of sensitive content.

export interface ReviewItemCreatedPayload {
  reviewItemId: string;
  clientId: string | null;
  artifactType: ReviewArtifactType;
  artifactId: string;
  artifactVersion: string;
  /** sha256 hex digest of the reviewed artifact content — digest only. */
  artifactDigest: string;
  workflowType: ReviewArtifactType;
  riskClassification: ReviewRiskClass;
  requiredReviewerRole: ReviewerRole;
  /** Birth state: "draft", or "awaiting_review" for gated AI output landing directly in the queue. */
  state: ReviewItemState;
  previousReviewItemId: string | null;
}

export interface ReviewItemSubmittedPayload {
  reviewItemId: string;
  artifactType: ReviewArtifactType;
  /** True only on the FIRST entry into awaiting_review (the metric anchor stamp). */
  firstSubmission: boolean;
}

export interface ReviewDecisionRecordedPayload {
  reviewItemId: string;
  decisionId: string;
  decision: ReviewDecision;
  /** Structured RVD_* reason code. */
  reasonCode: string;
  toState: ReviewItemState;
  escalatedToRole: ReviewerRole | null;
  /** Count of recorded field modifications (names/digests live on the records). */
  modifiedFieldCount: number;
}

export interface ReviewItemPublishedPayload {
  reviewItemId: string;
  artifactType: ReviewArtifactType;
  artifactId: string;
  artifactVersion: string;
  artifactDigest: string;
  publishedByStaffId: string;
}

export interface ReviewItemSupersededPayload {
  reviewItemId: string;
  supersededByReviewItemId: string;
}

export interface ReviewItemWithdrawnPayload {
  reviewItemId: string;
  artifactType: ReviewArtifactType;
  withdrawnByStaffId: string;
}

export interface ReviewOutcomeRecordedPayload {
  reviewItemId: string;
  clientActionStatus: string;
  outcome: string;
}

export interface PlaybookVersionSavedPayload {
  playbookId: string;
  playbookVersionId: string;
  version: string;
  authorStaffId: string;
}

export interface PlaybookVersionPublishedPayload {
  playbookId: string;
  playbookVersionId: string;
  version: string;
  publishedByStaffId: string;
  supersededVersionId: string | null;
  /** True when publication was allowed via the documented single-operator owner override. */
  usedOwnerOverride: boolean;
}

export interface WorkflowDiscoveryRaisedPayload {
  discoveryItemId: string;
  playbookId: string | null;
  checkpointRef: string | null;
}

export interface WorkflowDiscoveryResolvedPayload {
  discoveryItemId: string;
  toStatus: WorkflowDiscoveryStatus;
  /** The playbook version that absorbed the answer (converted only). */
  convertedPlaybookVersionId: string | null;
}

/** Compile-time map from event type to payload shape (exhaustive). */
export interface EventPayloadMap {
  LeadCreated: LeadCreatedPayload;
  LeadStatusChanged: LeadStatusChangedPayload;
  IntakeStarted: IntakeStartedPayload;
  IntakeSectionCompleted: IntakeSectionCompletedPayload;
  IntakeCompleted: IntakeCompletedPayload;
  ClientActivated: ClientActivatedPayload;
  FinancialProfileUpdated: FinancialProfileUpdatedPayload;
  CreditProfileUpdated: CreditProfileUpdatedPayload;
  GoalCreated: GoalCreatedPayload;
  ReadinessAssessed: ReadinessAssessedPayload;
  RoadmapDrafted: RoadmapDraftedPayload;
  RoadmapApproved: RoadmapApprovedPayload;
  RoadmapPublished: RoadmapPublishedPayload;
  MilestoneActivated: MilestoneActivatedPayload;
  TaskAssigned: TaskAssignedPayload;
  TaskCompleted: TaskCompletedPayload;
  DocumentRequested: DocumentRequestedPayload;
  DocumentUploaded: DocumentUploadedPayload;
  DocumentReviewed: DocumentReviewedPayload;
  AppointmentScheduled: AppointmentScheduledPayload;
  EngagementRiskDetected: EngagementRiskDetectedPayload;
  ProgressReportGenerated: ProgressReportGeneratedPayload;
  ProgressReportPublished: ProgressReportPublishedPayload;
  EducationAssigned: EducationAssignedPayload;
  EducationCompleted: EducationCompletedPayload;
  PartnerReferralCreated: PartnerReferralCreatedPayload;
  ConsentGranted: ConsentGrantedPayload;
  ConsentRevoked: ConsentRevokedPayload;
  MessagePosted: MessagePostedPayload;
  MessageRead: MessageReadPayload;
  ReviewItemCreated: ReviewItemCreatedPayload;
  ReviewItemSubmitted: ReviewItemSubmittedPayload;
  ReviewDecisionRecorded: ReviewDecisionRecordedPayload;
  ReviewItemPublished: ReviewItemPublishedPayload;
  ReviewItemSuperseded: ReviewItemSupersededPayload;
  ReviewItemWithdrawn: ReviewItemWithdrawnPayload;
  ReviewOutcomeRecorded: ReviewOutcomeRecordedPayload;
  PlaybookVersionSaved: PlaybookVersionSavedPayload;
  PlaybookVersionPublished: PlaybookVersionPublishedPayload;
  WorkflowDiscoveryRaised: WorkflowDiscoveryRaisedPayload;
  WorkflowDiscoveryResolved: WorkflowDiscoveryResolvedPayload;
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
