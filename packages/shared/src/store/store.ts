import {
  ACTION_RULES_VERSION,
  DOCUMENT_RULES_VERSION,
  INTAKE_RULES_VERSION,
  LIFECYCLE_STAGE_LABELS,
  PIPELINE_BACKBONE,
  READINESS_RULES_VERSION,
  REASON_CODE_NEXT_ACTIONS,
  REPORT_RULES_VERSION,
  actionTransition,
  assessEngagement,
  assessReadiness,
  assessmentReviewGate,
  documentTransition,
  intakeCompleteness,
  nextRequiredStage,
  pipelineTransition,
  quarterMonths,
  quarterOf,
  reportTransition,
  roadmapTransition,
  roundUpAmountCents,
  ROUNDUP_RULES_VERSION,
  sectionCompletion,
  validateMessageDraft,
  transitionThread,
  MESSAGING_RULES_VERSION,
  type MessageSenderRole,
  type ThreadAction,
  type ActionStatusId,
  type ActionTransitionResult,
  type DocumentReviewStatusId,
  type DocumentTransitionResult,
  type IntakeCompletenessResult,
  type PipelineTransitionResult,
  type ReportStatusId,
  type ReportTransitionResult,
  type ReviewGateResult,
  type RoadmapStatus,
  type RoadmapTransitionResult,
} from "@aflo/rules";
import {
  NOTIFICATION_RULES_VERSION,
  hasActiveConsent,
  renderNotification,
  resolveDelivery,
  type NotificationChannel,
  type NotificationType,
  type NotificationVarsMap,
} from "@aflo/notifications";
import {
  ACADEMY_LIBRARY,
  getLesson,
  scoreKnowledgeCheck,
  selectEducation,
  type EducationTrigger,
} from "@aflo/academy";
import {
  PARTNER_RULES_VERSION,
  partnerReferralTransition,
  validateNeutralityRecord,
  type NeutralityRecord,
  type PartnerReferralStatus,
  type PartnerReferralTransitionResult,
  type ReferralOutcome,
} from "@aflo/partner-marketplace";
import {
  assembleHandoffPackage,
  generateSigningKey,
  verifyHandoffPackage,
  type HandoffFacts,
  type HandoffPackage,
  type HandoffVerification,
  type SigningKeyPair,
} from "@aflo/security";
import { createEvent, type DomainEvent } from "../events";
import { toOutboxRecord, type OutboxRecord } from "../outbox";
import { syntheticDatabase, type SyntheticDatabase } from "../data/synthetic";
import {
  MockCreditDataProvider,
  UnknownSubjectError,
  summarizeCreditReport,
  type NormalizedCreditReport,
} from "@aflo/credit-data";
import {
  OPPORTUNITY_REGISTRY,
  matchNoticeToProfile,
  toClientSafeSummary,
} from "@aflo/opportunity-intelligence";
import { toReadinessFacts } from "../domain/facts";
import { buildResolutionReadout, type ResolutionReadout } from "../domain/resolution";
import type { CreditReportSummary } from "../domain/credit";
import type { ClientOpportunity } from "../domain/opportunity";
import {
  toClientThreadView,
  type ClientThreadView,
  type ConversationThread,
  type Message,
} from "../domain/messaging";
import type {
  AdminNote,
  Appointment,
  ClientDocument,
  ClientRecord,
  EducationAssignment,
  Goal,
  IntakeRecord,
  MonthlyAction,
  PartnerReferral,
  QuarterlyReport,
  ReadinessAssessmentRecord,
  Roadmap,
  SimulationSettings,
  VirtualTransaction,
} from "../domain/types";

/**
 * Mutable in-memory application store for the prototype phase (ADR-0002:
 * mock-first behind swappable contracts). It owns the working copy of the
 * synthetic database and applies workflow mutations the way the Neon layer
 * later will: rules-gated, event-emitting (outbox in the same "transaction"),
 * append-only audited, organization-scoped, with server-verified actors.
 *
 * State lives for the server-process lifetime and resets on restart —
 * acceptable and documented for the synthetic prototype; persistence arrives
 * with packages/database.
 *
 * Pipeline ↔ intake consistency: the two workflows are linked through the
 * founder-required backbone stage ids (PIPELINE_BACKBONE). Advancing a lead
 * into `intake_started` auto-starts its structured intake, and `intake_completed`
 * is only reachable when the intake rules declare the intake complete — the
 * stage can never claim a completeness the intake record contradicts.
 */

export interface AuditEntry {
  id: string;
  organizationId: string;
  /**
   * The staff/member actor id, or null for a non-member actor (e.g. a client
   * posting a secure message) — mirrors the DB's nullable actor_member_id. A
   * client's own identity is captured by the target row and the domain event,
   * not this staff-actor field, so audit-by-staff queries stay accurate.
   */
  actorStaffId: string | null;
  action: string; // e.g. "lead.stage_advanced", "intake.section_completed"
  targetType: string;
  targetId: string;
  detail: string;
  reasonCode: string;
  ruleVersion: string;
  occurredAt: string;
}

export type ConversionDenialCode =
  | "LEAD_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "NOT_A_LEAD"
  | "INTAKE_INCOMPLETE";

export interface ConversionResult {
  ok: boolean;
  /** Pipeline rule outcome when the rules were consulted. */
  transition?: PipelineTransitionResult;
  denialCode?: ConversionDenialCode;
  record?: ClientRecord;
  activated: boolean;
  emittedEventIds: string[];
}

export interface AdvanceLeadInput {
  organizationId: string;
  leadId: string;
  toStageId: string;
  /** Server-verified staff member performing the action — never client-supplied. */
  actorStaffId: string;
  reversal?: boolean;
}

export type IntakeDenialCode =
  | "CLIENT_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "INTAKE_NOT_STARTED"
  | "INTAKE_ALREADY_COMPLETED";

export interface IntakeActionResult {
  ok: boolean;
  denialCode?: IntakeDenialCode;
  /** Rule reason code (IN_* / PL_*) when a deterministic rule denied the action. */
  ruleReasonCode?: string;
  intake?: IntakeRecord;
  /** Present when completing the intake also moved the lead's pipeline stage. */
  transition?: PipelineTransitionResult;
  completeness?: IntakeCompletenessResult;
  emittedEventIds: string[];
}

export interface IntakeSectionInput {
  organizationId: string;
  clientId: string;
  sectionId: string;
  actorStaffId: string;
}

export interface CompleteIntakeInput {
  organizationId: string;
  clientId: string;
  actorStaffId: string;
}

export type RoadmapDenialCode = "ROADMAP_NOT_FOUND" | "ACTOR_NOT_IN_ORG";

export interface RoadmapActionResult {
  ok: boolean;
  denialCode?: RoadmapDenialCode;
  transition?: RoadmapTransitionResult;
  roadmap?: Roadmap;
  emittedEventIds: string[];
}

export interface TransitionRoadmapInput {
  organizationId: string;
  roadmapId: string;
  toStatus: RoadmapStatus;
  actorStaffId: string;
}

export type MonthlyActionDenialCode =
  | "CLIENT_NOT_FOUND"
  | "ACTION_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "INVALID_INPUT";

export interface MonthlyActionResult {
  ok: boolean;
  denialCode?: MonthlyActionDenialCode;
  /** Rule outcome when the transition rules were consulted. */
  transition?: ActionTransitionResult;
  action?: MonthlyAction;
  /** Human-readable validation failures for INVALID_INPUT. */
  inputErrors?: string[];
  emittedEventIds: string[];
}

export interface AddMonthlyActionInput {
  organizationId: string;
  clientId: string;
  title: string;
  category: MonthlyAction["category"];
  /** ISO date; the action belongs to the month it is due. */
  dueDate: string;
  actorStaffId: string;
}

export interface TransitionMonthlyActionInput {
  organizationId: string;
  actionId: string;
  toStatus: ActionStatusId;
  actorStaffId: string;
}

export type ReportDenialCode =
  | "CLIENT_NOT_FOUND"
  | "REPORT_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "NOT_A_CLIENT"
  | "NO_RECORDED_ASSESSMENT"
  | "REPORT_EXISTS_FOR_QUARTER";

export interface ReportActionResult {
  ok: boolean;
  denialCode?: ReportDenialCode;
  transition?: ReportTransitionResult;
  report?: QuarterlyReport;
  emittedEventIds: string[];
}

export interface GenerateReportInput {
  organizationId: string;
  clientId: string;
  actorStaffId: string;
}

export interface TransitionReportInput {
  organizationId: string;
  reportId: string;
  toStatus: ReportStatusId;
  actorStaffId: string;
}

export type GoalDenialCode = "CLIENT_NOT_FOUND" | "GOAL_NOT_FOUND" | "ACTOR_NOT_IN_ORG" | "INVALID_INPUT";

export interface GoalResult {
  ok: boolean;
  denialCode?: GoalDenialCode;
  inputErrors?: string[];
  goal?: Goal;
  emittedEventIds: string[];
}

export interface CreateGoalInput {
  organizationId: string;
  clientId: string;
  title: string;
  category: Goal["category"];
  targetDate: string; // ISO date
  isPrimary: boolean;
  actorStaffId: string;
}

export interface UpdateGoalProgressInput {
  organizationId: string;
  goalId: string;
  progressPct: number;
  actorStaffId: string;
}

export interface SetPrimaryGoalInput {
  organizationId: string;
  goalId: string;
  actorStaffId: string;
}

export type SimulationDenialCode = "CLIENT_NOT_FOUND" | "ACTOR_NOT_IN_ORG" | "INVALID_INPUT";

export interface SimulationResult {
  ok: boolean;
  denialCode?: SimulationDenialCode;
  inputErrors?: string[];
  settings?: SimulationSettings;
  transaction?: VirtualTransaction;
}

export interface ConfigureSimulationInput {
  organizationId: string;
  clientId: string;
  roundToCents: number;
  multiplier: number;
  enabled: boolean;
  actorStaffId: string;
}

export interface AddVirtualTransactionInput {
  organizationId: string;
  clientId: string;
  label: string;
  amountCents: number;
  occurredOn: string; // ISO date
  actorStaffId: string;
}

export type StaffWorkflowDenialCode =
  | "CLIENT_NOT_FOUND"
  | "DOCUMENT_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "INVALID_INPUT";

export interface DocumentActionResult {
  ok: boolean;
  denialCode?: StaffWorkflowDenialCode;
  transition?: DocumentTransitionResult;
  document?: ClientDocument;
  inputErrors?: string[];
  emittedEventIds: string[];
}

export interface RequestDocumentInput {
  organizationId: string;
  clientId: string;
  name: string;
  docType: ClientDocument["docType"];
  actorStaffId: string;
}

export interface TransitionDocumentInput {
  organizationId: string;
  documentId: string;
  toStatus: DocumentReviewStatusId;
  actorStaffId: string;
}

export interface AppointmentActionResult {
  ok: boolean;
  denialCode?: StaffWorkflowDenialCode;
  appointment?: Appointment;
  inputErrors?: string[];
  emittedEventIds: string[];
}

export interface ScheduleAppointmentInput {
  organizationId: string;
  clientId: string;
  purpose: string;
  /** ISO datetime; must parse and lie in the future of the store clock. */
  scheduledAt: string;
  channel: Appointment["channel"];
  actorStaffId: string;
}

export interface NoteActionResult {
  ok: boolean;
  denialCode?: StaffWorkflowDenialCode;
  note?: AdminNote;
  inputErrors?: string[];
}

export interface AddNoteInput {
  organizationId: string;
  clientId: string;
  body: string;
  actorStaffId: string;
}

export type MessagingDenialCode =
  | "CLIENT_NOT_FOUND"
  | "THREAD_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "NOT_THREAD_CLIENT"
  | "INVALID_INPUT";

export interface OpenThreadInput {
  organizationId: string;
  clientId: string;
  subject: string;
  /** The staff member's opening message. */
  body: string;
  actorStaffId: string;
}

export interface PostReplyInput {
  organizationId: string;
  threadId: string;
  senderRole: MessageSenderRole;
  /** Staff member id when senderRole="staff"; the thread's own client id when "client". */
  senderId: string;
  body: string;
}

export interface ThreadResult {
  ok: boolean;
  denialCode?: MessagingDenialCode;
  /** Kernel reason code when the message body/thread state was rejected. */
  reasonCode?: string;
  inputErrors?: string[];
  thread?: ConversationThread;
  message?: Message;
  emittedEventIds: string[];
}

export interface MessageResult {
  ok: boolean;
  denialCode?: MessagingDenialCode;
  reasonCode?: string;
  message?: Message;
  emittedEventIds: string[];
}

export interface ThreadStatusInput {
  organizationId: string;
  threadId: string;
  actorStaffId: string;
}

export type AssessmentDenialCode =
  | "CLIENT_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "INTAKE_NOT_COMPLETED"
  | "MISSING_FACTS";

export interface AssessmentResult {
  ok: boolean;
  denialCode?: AssessmentDenialCode;
  /** Profile data absent when the attempt was blocked (MISSING_FACTS). */
  missingFacts?: string[];
  record?: ReadinessAssessmentRecord;
  review?: ReviewGateResult;
  emittedEventIds: string[];
}

export interface RunAssessmentInput {
  organizationId: string;
  clientId: string;
  actorStaffId: string;
}

/**
 * A recorded outbound communication (charter: communication history). The
 * consent gate runs before any content is planned, so a suppressed entry
 * carries no rendered subject — only the reason it was withheld.
 */
export interface CommunicationLogEntry {
  id: string;
  organizationId: string;
  clientId: string;
  notificationType: NotificationType;
  /** Always one of NOTIFICATION_CHANNELS — typed so the DB enum column is sound. */
  channel: NotificationChannel;
  /** "sent" = mock-delivered in dev; "suppressed" = withheld by the consent gate. */
  status: "sent" | "suppressed";
  subject: string | null;
  suppressionReason: string | null;
  occurredAt: string;
}

export interface ReferralResult {
  ok: boolean;
  denialCode?:
    | "CLIENT_NOT_FOUND"
    | "ACTOR_NOT_IN_ORG"
    | "PARTNER_NOT_FOUND"
    | "PARTNER_INACTIVE"
    | "NEUTRALITY_INCOMPLETE"
    | "REFERRAL_NOT_FOUND";
  missingNeutralityFields?: string[];
  referral?: PartnerReferral;
  transition?: PartnerReferralTransitionResult;
  emittedEventIds: string[];
}

export interface CreateReferralInput {
  organizationId: string;
  clientId: string;
  partnerId: string;
  /** The eight-field neutrality record; a referral is refused without a complete one. */
  neutrality: NeutralityRecord;
  actorStaffId: string;
}

export interface TransitionReferralInput {
  organizationId: string;
  referralId: string;
  /** Outcome is recorded via recordReferralOutcome, never this transition. */
  toStatus: Exclude<PartnerReferralStatus, "suggested" | "outcome_recorded">;
  actorStaffId: string;
}

export interface RecordReferralOutcomeInput {
  organizationId: string;
  referralId: string;
  outcome: ReferralOutcome;
  note?: string;
  actorStaffId: string;
}

export type HandoffDenialCode =
  | "CLIENT_NOT_FOUND"
  | "ACTOR_NOT_IN_ORG"
  | "NO_PARTNER_CONSENT"
  | "NO_VERIFIED_ASSESSMENT"
  | "PACKAGE_NOT_FOUND"
  | "ALREADY_REVOKED";

export interface HandoffResult {
  ok: boolean;
  denialCode?: HandoffDenialCode;
  package?: HandoffPackage;
}

export interface GenerateHandoffInput {
  organizationId: string;
  clientId: string;
  /** Who may consume the package (e.g. "partner-cpa:acme-tax"). */
  recipientScope: string;
  actorStaffId: string;
}

export interface RevokeHandoffInput {
  organizationId: string;
  packageId: string;
  actorStaffId: string;
}

/** How long an issued handoff package stays valid (days) before it expires. */
const HANDOFF_VALIDITY_DAYS = 30;

export class AfloStore {
  private readonly db: SyntheticDatabase;
  readonly outbox: OutboxRecord[] = [];
  readonly auditLog: AuditEntry[] = [];
  readonly communicationsLog: CommunicationLogEntry[] = [];
  /**
   * Dev-only signing key for verification handoff packages. Generated per
   * process; packages verify within the same running store. In production the
   * private key lives in a managed KMS/HSM and never in the process memory
   * this way (charter; ADR-0009). Never serialized, logged, or exposed.
   */
  private readonly signingKey: SigningKeyPair = generateSigningKey();
  private counter = 0;
  /**
   * Provider-neutral credit-data source. In V1 it is ALWAYS the synthetic mock
   * (`isProduction` false, no bureau). A real bureau adapter would drop in
   * behind this same interface only under a reviewed contract (ADR-0007 §5).
   */
  private readonly creditProvider: MockCreditDataProvider;

  constructor(
    seed: SyntheticDatabase = syntheticDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.db = structuredClone(seed);
    this.creditProvider = new MockCreditDataProvider(
      Object.fromEntries(this.db.creditReports.map((r) => [r.subjectRef, r])),
    );
  }

  /** Live view for repositories — mutations are visible to readers. */
  database(): SyntheticDatabase {
    return this.db;
  }

  pipelineFor(organizationId: string) {
    return this.db.organization.id === organizationId ? this.db.pipeline : null;
  }

  intakeDefinitionFor(organizationId: string) {
    return this.db.organization.id === organizationId ? this.db.intake : null;
  }

  /** The client's intake record, organization-verified. */
  intakeFor(organizationId: string, clientId: string): IntakeRecord | null {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return null;
    return this.db.intakes.find((i) => i.clientId === clientId) ?? null;
  }

  auditFor(organizationId: string): AuditEntry[] {
    return this.auditLog.filter((a) => a.organizationId === organizationId);
  }

  /**
   * Advance (or explicitly reverse) a lead through the organization's
   * pipeline. Denials never mutate, and denied *rule* attempts are audited —
   * a skipped required stage is a material fact, not a silent no-op.
   */
  advanceLead(input: AdvanceLeadInput): ConversionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.leadId);
    if (!record) return { ok: false, denialCode: "LEAD_NOT_FOUND", activated: false, emittedEventIds: [] };

    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", activated: false, emittedEventIds: [] };

    if (record.kind !== "lead") {
      return { ok: false, denialCode: "NOT_A_LEAD", activated: false, emittedEventIds: [] };
    }

    const transition = pipelineTransition(this.db.pipeline, record.pipelineStageId, input.toStageId, {
      reversal: input.reversal,
    });

    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "lead.stage_denied",
        targetType: "lead",
        targetId: record.id,
        detail: `${record.pipelineStageId} → ${input.toStageId} denied${
          transition.skippedRequiredStageIds.length > 0
            ? ` (skips: ${transition.skippedRequiredStageIds.join(", ")})`
            : ""
        }`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, activated: false, emittedEventIds: [] };
    }

    // Backbone gate: the intake_completed stage is a claim of completeness,
    // so entering it requires the intake rules to agree. Fail closed.
    if (input.toStageId === PIPELINE_BACKBONE.intakeCompleted) {
      const intake = this.db.intakes.find((i) => i.clientId === record.id);
      const completeness = intake
        ? intakeCompleteness(this.db.intake, intake.completedSectionIds)
        : null;
      if (!intake || !completeness?.complete) {
        this.audit({
          organizationId: input.organizationId,
          actorStaffId: actor.id,
          action: "lead.stage_denied",
          targetType: "lead",
          targetId: record.id,
          detail: intake
            ? `${record.pipelineStageId} → ${input.toStageId} denied: intake incomplete (missing: ${completeness?.missingRequiredSectionIds.join(", ")})`
            : `${record.pipelineStageId} → ${input.toStageId} denied: intake not started`,
          reasonCode: completeness?.reasonCode ?? "IN_MISSING_REQUIRED",
          ruleVersion: INTAKE_RULES_VERSION,
          occurredAt: now.toISOString(),
        });
        return { ok: false, denialCode: "INTAKE_INCOMPLETE", transition, activated: false, emittedEventIds: [] };
      }
    }

    const fromStageId = record.pipelineStageId;
    record.pipelineStageId = input.toStageId;
    record.lastActivityAt = now.toISOString();

    const statusChanged = createEvent({
      eventType: "LeadStatusChanged",
      organizationId: input.organizationId,
      aggregateId: record.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        leadId: record.id,
        fromStatus: fromStageId,
        toStatus: input.toStageId,
        reasonCode: transition.reasonCode,
      },
    });
    const emitted: DomainEvent[] = [statusChanged];

    // Backbone hook: reaching intake_started starts the structured intake so
    // the checklist and the stage can never drift apart.
    if (
      input.toStageId === PIPELINE_BACKBONE.intakeStarted &&
      !input.reversal &&
      !this.db.intakes.some((i) => i.clientId === record.id)
    ) {
      const intake: IntakeRecord = {
        id: `intake-${record.id}`,
        clientId: record.id,
        status: "in_progress",
        completedSectionIds: [],
        startedAt: now.toISOString(),
        completedAt: null,
      };
      this.db.intakes.push(intake);
      emitted.push(
        createEvent({
          eventType: "IntakeStarted",
          organizationId: input.organizationId,
          aggregateId: record.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          correlationId: statusChanged.correlationId,
          causationId: statusChanged.eventId,
          payload: { clientId: record.id, leadId: record.id, intakeId: intake.id },
        }),
      );
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "intake.started",
        targetType: "intake",
        targetId: record.id,
        detail: `intake ${intake.id} opened with ${this.db.intake.sections.length} sections`,
        reasonCode: "IN_OK",
        ruleVersion: INTAKE_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
    }

    const target = this.db.pipeline.stages.find((s) => s.id === input.toStageId);
    const activated = target?.terminal === true;
    if (activated) {
      record.kind = "client";
      record.clientStatus = "active";
      emitted.push(
        createEvent({
          eventType: "ClientActivated",
          organizationId: input.organizationId,
          aggregateId: record.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          correlationId: statusChanged.correlationId,
          causationId: statusChanged.eventId,
          payload: {
            clientId: record.id,
            convertedFromLeadId: record.id,
            assignedStaffId: record.assignedStaffId,
          },
        }),
      );
    }

    for (const event of emitted) {
      this.outbox.push(toOutboxRecord(event, { now }));
    }

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: activated ? "lead.activated" : input.reversal ? "lead.stage_reversed" : "lead.stage_advanced",
      targetType: activated ? "client" : "lead",
      targetId: record.id,
      detail: `${fromStageId} → ${input.toStageId}`,
      reasonCode: transition.reasonCode,
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, transition, record, activated, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /** Mark one intake section complete. Rules-gated; denials audited, never mutate. */
  completeIntakeSection(input: IntakeSectionInput): IntakeActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };
    const intake = this.db.intakes.find((i) => i.clientId === record.id);
    if (!intake) return { ok: false, denialCode: "INTAKE_NOT_STARTED", emittedEventIds: [] };
    if (intake.status === "completed") {
      return { ok: false, denialCode: "INTAKE_ALREADY_COMPLETED", intake, emittedEventIds: [] };
    }

    const check = sectionCompletion(this.db.intake, intake.completedSectionIds, input.sectionId);
    if (!check.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "intake.section_denied",
        targetType: "intake",
        targetId: record.id,
        detail: `section ${input.sectionId} denied`,
        reasonCode: check.reasonCode,
        ruleVersion: check.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, ruleReasonCode: check.reasonCode, intake, emittedEventIds: [] };
    }

    intake.completedSectionIds.push(input.sectionId);
    record.lastActivityAt = now.toISOString();
    const completeness = intakeCompleteness(this.db.intake, intake.completedSectionIds);

    const event = createEvent({
      eventType: "IntakeSectionCompleted",
      organizationId: input.organizationId,
      aggregateId: record.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        intakeId: intake.id,
        sectionId: input.sectionId,
        completedRequiredCount: completeness.completedRequiredCount,
        requiredCount: completeness.requiredCount,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "intake.section_completed",
      targetType: "intake",
      targetId: record.id,
      detail: `section ${input.sectionId} complete (${completeness.completedRequiredCount}/${completeness.requiredCount} required)`,
      reasonCode: check.reasonCode,
      ruleVersion: check.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, intake, completeness, emittedEventIds: [event.eventId] };
  }

  /**
   * Declare the intake complete. Only the completeness rules can say yes;
   * for leads this also advances the pipeline to the intake_completed
   * backbone stage in the same operation (both or neither — no drift).
   */
  completeIntake(input: CompleteIntakeInput): IntakeActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };
    const intake = this.db.intakes.find((i) => i.clientId === record.id);
    if (!intake) return { ok: false, denialCode: "INTAKE_NOT_STARTED", emittedEventIds: [] };
    if (intake.status === "completed") {
      return { ok: false, denialCode: "INTAKE_ALREADY_COMPLETED", intake, emittedEventIds: [] };
    }

    const completeness = intakeCompleteness(this.db.intake, intake.completedSectionIds);
    if (!completeness.complete) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "intake.complete_denied",
        targetType: "intake",
        targetId: record.id,
        detail: `completion denied (missing: ${completeness.missingRequiredSectionIds.join(", ")})`,
        reasonCode: completeness.reasonCode,
        ruleVersion: completeness.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, ruleReasonCode: completeness.reasonCode, intake, completeness, emittedEventIds: [] };
    }

    // For a lead, the stage move must be legal too — otherwise nothing mutates.
    let transition: PipelineTransitionResult | undefined;
    const movesStage =
      record.kind === "lead" && record.pipelineStageId !== PIPELINE_BACKBONE.intakeCompleted;
    if (movesStage) {
      transition = pipelineTransition(
        this.db.pipeline,
        record.pipelineStageId,
        PIPELINE_BACKBONE.intakeCompleted,
      );
      if (!transition.allowed) {
        this.audit({
          organizationId: input.organizationId,
          actorStaffId: actor.id,
          action: "intake.complete_denied",
          targetType: "intake",
          targetId: record.id,
          detail: `completion denied: stage ${record.pipelineStageId} → ${PIPELINE_BACKBONE.intakeCompleted} not allowed`,
          reasonCode: transition.reasonCode,
          ruleVersion: transition.ruleVersion,
          occurredAt: now.toISOString(),
        });
        return { ok: false, ruleReasonCode: transition.reasonCode, intake, transition, emittedEventIds: [] };
      }
    }

    intake.status = "completed";
    intake.completedAt = now.toISOString();
    record.lastActivityAt = now.toISOString();

    const completedEvent = createEvent({
      eventType: "IntakeCompleted",
      organizationId: input.organizationId,
      aggregateId: record.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        intakeId: intake.id,
        completedSections: [...intake.completedSectionIds],
        missingSections: [],
      },
    });
    const emitted: DomainEvent[] = [completedEvent];

    if (movesStage && transition) {
      const fromStageId = record.pipelineStageId;
      record.pipelineStageId = PIPELINE_BACKBONE.intakeCompleted;
      emitted.push(
        createEvent({
          eventType: "LeadStatusChanged",
          organizationId: input.organizationId,
          aggregateId: record.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          correlationId: completedEvent.correlationId,
          causationId: completedEvent.eventId,
          payload: {
            leadId: record.id,
            fromStatus: fromStageId,
            toStatus: PIPELINE_BACKBONE.intakeCompleted,
            reasonCode: transition.reasonCode,
          },
        }),
      );
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "lead.stage_advanced",
        targetType: "lead",
        targetId: record.id,
        detail: `${fromStageId} → ${PIPELINE_BACKBONE.intakeCompleted}`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
    }

    for (const event of emitted) {
      this.outbox.push(toOutboxRecord(event, { now }));
    }

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "intake.completed",
      targetType: "intake",
      targetId: record.id,
      detail: `all ${completeness.requiredCount} required sections complete`,
      reasonCode: completeness.reasonCode,
      ruleVersion: completeness.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, intake, transition, completeness, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /**
   * Move a roadmap through the approval workflow (roadmap.v1.0.0). The
   * roadmap is only reachable through its org-checked client; denials are
   * audited and never mutate. Approval stamps the approving staff member;
   * publication stamps the publish time; a reopen withdraws the approval.
   */
  transitionRoadmap(input: TransitionRoadmapInput): RoadmapActionResult {
    const now = this.clock();
    const roadmap = this.db.roadmaps.find((r) => r.id === input.roadmapId);
    const client = roadmap ? this.findRecord(input.organizationId, roadmap.clientId) : undefined;
    if (!roadmap || !client) return { ok: false, denialCode: "ROADMAP_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = roadmapTransition(roadmap.status, input.toStatus);
    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "roadmap.transition_denied",
        targetType: "roadmap",
        targetId: roadmap.id,
        detail: `client ${client.id}: ${roadmap.status} → ${input.toStatus} denied`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, emittedEventIds: [] };
    }

    const fromStatus = roadmap.status;
    roadmap.status = input.toStatus;
    if (input.toStatus === "approved") {
      roadmap.approvedByStaffId = actor.id;
      roadmap.approvedAt = now.toISOString();
    }
    if (input.toStatus === "published") {
      roadmap.publishedAt = now.toISOString();
    }
    if (transition.reasonCode === "RM_REOPENED") {
      roadmap.approvedByStaffId = null;
      roadmap.approvedAt = null;
    }

    const emitted: DomainEvent[] = [];
    if (input.toStatus === "approved") {
      emitted.push(
        createEvent({
          eventType: "RoadmapApproved",
          organizationId: input.organizationId,
          aggregateId: roadmap.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          payload: {
            clientId: client.id,
            roadmapId: roadmap.id,
            approvedByMemberId: actor.id,
            publishedToClient: false,
          },
        }),
      );
    }
    if (input.toStatus === "published") {
      emitted.push(
        createEvent({
          eventType: "RoadmapPublished",
          organizationId: input.organizationId,
          aggregateId: roadmap.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          payload: { clientId: client.id, roadmapId: roadmap.id, publishedByMemberId: actor.id },
        }),
      );
    }
    for (const event of emitted) {
      this.outbox.push(toOutboxRecord(event, { now }));
    }

    const ACTION_BY_CODE: Record<string, string> = {
      RM_SUBMITTED: "roadmap.submitted",
      RM_APPROVED: "roadmap.approved",
      RM_RETURNED: "roadmap.returned",
      RM_PUBLISHED: "roadmap.published",
      RM_REOPENED: "roadmap.reopened",
      RM_ARCHIVED: "roadmap.archived",
    };
    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: ACTION_BY_CODE[transition.reasonCode] ?? "roadmap.transitioned",
      targetType: "roadmap",
      targetId: roadmap.id,
      detail: `client ${client.id}: ${fromStatus} → ${input.toStatus}`,
      reasonCode: transition.reasonCode,
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    if (input.toStatus === "published") {
      this.logNotification(
        input.organizationId,
        client,
        "roadmap_published",
        { firstName: client.firstName, roadmapTitle: roadmap.title },
        now,
      );
    }

    return { ok: true, transition, roadmap, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /**
   * Add a manual monthly action to a client's plan. The action belongs to
   * the month it is due — deterministic from input, independent of the
   * server clock. Emits TaskAssigned; invalid input is audited and denied.
   */
  addMonthlyAction(input: AddMonthlyActionInput): MonthlyActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const CATEGORIES: MonthlyAction["category"][] = ["payment", "savings", "documentation", "education", "habit"];
    const title = input.title.trim();
    const inputErrors: string[] = [];
    if (title.length === 0) inputErrors.push("title is required");
    if (!CATEGORIES.includes(input.category)) inputErrors.push(`unknown category: ${String(input.category)}`);
    if (Number.isNaN(Date.parse(input.dueDate))) inputErrors.push(`due date is not a valid date: ${input.dueDate}`);
    if (inputErrors.length > 0) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "action.create_denied",
        targetType: "monthly_action",
        targetId: record.id,
        detail: inputErrors.join("; "),
        reasonCode: "AC_INVALID_INPUT",
        ruleVersion: ACTION_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors, emittedEventIds: [] };
    }

    this.counter += 1;
    const action: MonthlyAction = {
      id: `ma-${record.id}-${this.counter}`,
      clientId: record.id,
      month: new Date(input.dueDate).toISOString().slice(0, 7),
      title,
      category: input.category,
      status: "todo",
      dueDate: new Date(input.dueDate).toISOString(),
    };
    this.db.monthlyActions.push(action);

    const event = createEvent({
      eventType: "TaskAssigned",
      organizationId: input.organizationId,
      aggregateId: action.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        taskId: action.id,
        milestoneId: null,
        templateId: null,
        dueDate: action.dueDate,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "action.assigned",
      targetType: "monthly_action",
      targetId: action.id,
      detail: `client ${record.id}: "${title}" (${input.category}) due ${action.dueDate.slice(0, 10)}`,
      reasonCode: "AC_ASSIGNED",
      ruleVersion: ACTION_RULES_VERSION,
      occurredAt: now.toISOString(),
    });

    this.logNotification(
      input.organizationId,
      record,
      "task_assigned",
      { firstName: record.firstName, taskTitle: title, dueDate: action.dueDate.slice(0, 10) },
      now,
    );

    return { ok: true, action, emittedEventIds: [event.eventId] };
  }

  /**
   * Move a monthly action through its status workflow (action.v1.0.0).
   * Completion emits TaskCompleted with the verifying staff member; reopens
   * are flagged distinctly by the rules. Denials are audited, never mutate.
   */
  transitionMonthlyAction(input: TransitionMonthlyActionInput): MonthlyActionResult {
    const now = this.clock();
    const action = this.db.monthlyActions.find((a) => a.id === input.actionId);
    const client = action ? this.findRecord(input.organizationId, action.clientId) : undefined;
    if (!action || !client) return { ok: false, denialCode: "ACTION_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = actionTransition(action.status, input.toStatus);
    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "action.transition_denied",
        targetType: "monthly_action",
        targetId: action.id,
        detail: `client ${client.id}: ${action.status} → ${input.toStatus} denied`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, emittedEventIds: [] };
    }

    const fromStatus = action.status;
    action.status = input.toStatus;
    client.lastActivityAt = now.toISOString();

    const emitted: DomainEvent[] = [];
    if (input.toStatus === "done") {
      emitted.push(
        createEvent({
          eventType: "TaskCompleted",
          organizationId: input.organizationId,
          aggregateId: action.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          payload: {
            clientId: client.id,
            taskId: action.id,
            completedBy: "staff",
            verifiedByMemberId: actor.id,
            evidenceDocumentId: null,
          },
        }),
      );
    }
    for (const event of emitted) {
      this.outbox.push(toOutboxRecord(event, { now }));
    }

    const ACTION_BY_CODE: Record<string, string> = {
      AC_STARTED: "action.started",
      AC_COMPLETED: "action.completed",
      AC_PAUSED: "action.paused",
      AC_REOPENED: "action.reopened",
    };
    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: ACTION_BY_CODE[transition.reasonCode] ?? "action.transitioned",
      targetType: "monthly_action",
      targetId: action.id,
      detail: `client ${client.id}: ${fromStatus} → ${input.toStatus}`,
      reasonCode: transition.reasonCode,
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, transition, action, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /**
   * Generate the current quarter's progress report from verified, recorded
   * facts — the latest recorded readiness assessment (required), the
   * quarter's action-plan statistics, approved documents, and the roadmap.
   * Purely deterministic content; the report-agent may later add narrative
   * language behind review. Always starts as a draft; one report per
   * client-quarter.
   */
  generateQuarterlyReport(input: GenerateReportInput): ReportActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };
    if (record.kind !== "client") {
      return { ok: false, denialCode: "NOT_A_CLIENT", emittedEventIds: [] };
    }

    const assessment = this.db.assessments.filter((a) => a.clientId === record.id).at(-1);
    if (!assessment) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "report.generate_denied",
        targetType: "report",
        targetId: record.id,
        detail: "no recorded readiness assessment — reports draw only on recorded facts",
        reasonCode: "NO_RECORDED_ASSESSMENT",
        ruleVersion: REPORT_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "NO_RECORDED_ASSESSMENT", emittedEventIds: [] };
    }

    const quarter = quarterOf(now);
    if (this.db.reports.some((r) => r.clientId === record.id && r.quarter === quarter)) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "report.generate_denied",
        targetType: "report",
        targetId: record.id,
        detail: `a ${quarter} report already exists`,
        reasonCode: "REPORT_EXISTS_FOR_QUARTER",
        ruleVersion: REPORT_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "REPORT_EXISTS_FOR_QUARTER", emittedEventIds: [] };
    }

    // Deterministic content from recorded/verified facts only.
    const highlights: string[] = [
      `Readiness stage: ${LIFECYCLE_STAGE_LABELS[assessment.stage]} (rule ${assessment.ruleVersion})`,
    ];
    if (assessment.previousStage && assessment.previousStage !== assessment.stage) {
      highlights.push(
        `Stage moved from ${LIFECYCLE_STAGE_LABELS[assessment.previousStage]} to ${LIFECYCLE_STAGE_LABELS[assessment.stage]} this period`,
      );
    }
    const months = quarterMonths(quarter);
    const quarterActions = this.db.monthlyActions.filter(
      (a) => a.clientId === record.id && months.includes(a.month),
    );
    if (quarterActions.length > 0) {
      const done = quarterActions.filter((a) => a.status === "done").length;
      highlights.push(`Action plan: ${done} of ${quarterActions.length} actions completed this quarter`);
    }
    const approvedDocs = this.db.documents.filter(
      (d) => d.clientId === record.id && d.reviewStatus === "approved",
    ).length;
    if (approvedDocs > 0) {
      highlights.push(`Verified documents on file: ${approvedDocs}`);
    }
    const roadmap = this.db.roadmaps.filter((r) => r.clientId === record.id && r.status !== "archived").at(-1);
    if (roadmap?.status === "published") {
      const done = this.db.milestones.filter((m) => m.roadmapId === roadmap.id && m.status === "completed").length;
      const total = this.db.milestones.filter((m) => m.roadmapId === roadmap.id).length;
      highlights.push(`Roadmap "${roadmap.title}": ${done} of ${total} milestones complete`);
    }

    this.counter += 1;
    const report: QuarterlyReport = {
      id: `qr-${record.id}-${quarter.toLowerCase()}-${this.counter}`,
      clientId: record.id,
      quarter,
      status: "draft",
      stageAtGeneration: assessment.stage,
      highlights,
      focusForNextQuarter: assessment.proposedNextAction,
      generatedAt: now.toISOString(),
    };
    this.db.reports.push(report);

    const event = createEvent({
      eventType: "ProgressReportGenerated",
      organizationId: input.organizationId,
      aggregateId: report.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        reportId: report.id,
        quarter,
        reviewStatus: "pending_review",
        aiRunId: null,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "report.generated",
      targetType: "report",
      targetId: report.id,
      detail: `client ${record.id}: ${quarter} draft from recorded facts (${highlights.length} highlights)`,
      reasonCode: "RP_GENERATED",
      ruleVersion: REPORT_RULES_VERSION,
      occurredAt: now.toISOString(),
    });

    return { ok: true, report, emittedEventIds: [event.eventId] };
  }

  /**
   * Move a report through review (report.v1.0.0). Publication emits
   * ProgressReportPublished; published reports are terminal. Denials are
   * audited and never mutate.
   */
  transitionReport(input: TransitionReportInput): ReportActionResult {
    const now = this.clock();
    const report = this.db.reports.find((r) => r.id === input.reportId);
    const client = report ? this.findRecord(input.organizationId, report.clientId) : undefined;
    if (!report || !client) return { ok: false, denialCode: "REPORT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = reportTransition(report.status, input.toStatus);
    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "report.transition_denied",
        targetType: "report",
        targetId: report.id,
        detail: `client ${client.id}: ${report.status} → ${input.toStatus} denied`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, emittedEventIds: [] };
    }

    const fromStatus = report.status;
    report.status = input.toStatus;

    const emitted: DomainEvent[] = [];
    if (input.toStatus === "published") {
      emitted.push(
        createEvent({
          eventType: "ProgressReportPublished",
          organizationId: input.organizationId,
          aggregateId: report.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          payload: {
            clientId: client.id,
            reportId: report.id,
            quarter: report.quarter,
            publishedByMemberId: actor.id,
          },
        }),
      );
    }
    for (const event of emitted) {
      this.outbox.push(toOutboxRecord(event, { now }));
    }

    const ACTION_BY_CODE: Record<string, string> = {
      RP_SUBMITTED: "report.submitted",
      RP_RETURNED: "report.returned",
      RP_PUBLISHED: "report.published",
    };
    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: ACTION_BY_CODE[transition.reasonCode] ?? "report.transitioned",
      targetType: "report",
      targetId: report.id,
      detail: `client ${client.id}: ${fromStatus} → ${input.toStatus} (${report.quarter})`,
      reasonCode: transition.reasonCode,
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    if (input.toStatus === "published") {
      this.logNotification(
        input.organizationId,
        client,
        "report_published",
        { firstName: client.firstName, quarter: report.quarter },
        now,
      );
    }

    return { ok: true, transition, report, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /** Request a document from a client. Emits DocumentRequested; audited. */
  requestDocument(input: RequestDocumentInput): DocumentActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const DOC_TYPES: ClientDocument["docType"][] = [
      "credit_report",
      "income_verification",
      "bank_statement",
      "identification",
      "other",
    ];
    const name = input.name.trim();
    const inputErrors: string[] = [];
    if (name.length === 0) inputErrors.push("document name is required");
    if (!DOC_TYPES.includes(input.docType)) inputErrors.push(`unknown document type: ${String(input.docType)}`);
    if (inputErrors.length > 0) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "doc.request_denied",
        targetType: "document",
        targetId: record.id,
        detail: inputErrors.join("; "),
        reasonCode: "DOC_INVALID_INPUT",
        ruleVersion: DOCUMENT_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors, emittedEventIds: [] };
    }

    this.counter += 1;
    const document: ClientDocument = {
      id: `d-${record.id}-${this.counter}`,
      clientId: record.id,
      name,
      docType: input.docType,
      reviewStatus: "requested",
      updatedAt: now.toISOString(),
    };
    this.db.documents.push(document);

    const event = createEvent({
      eventType: "DocumentRequested",
      organizationId: input.organizationId,
      aggregateId: document.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: { clientId: record.id, documentId: document.id, docType: input.docType, dueDate: null },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "doc.requested",
      targetType: "document",
      targetId: document.id,
      detail: `client ${record.id}: "${name}" (${input.docType})`,
      reasonCode: "DOC_REQUESTED",
      ruleVersion: DOCUMENT_RULES_VERSION,
      occurredAt: now.toISOString(),
    });

    this.logNotification(
      input.organizationId,
      record,
      "document_requested",
      { firstName: record.firstName, documentName: name },
      now,
    );

    return { ok: true, document, emittedEventIds: [event.eventId] };
  }

  /**
   * Move a document through review (document.v1.0.0). Receipt emits
   * DocumentUploaded (metadata only — the storage reference is a synthetic
   * placeholder until real signed-URL storage lands); review decisions emit
   * DocumentReviewed. Denials are audited and never mutate.
   */
  transitionDocument(input: TransitionDocumentInput): DocumentActionResult {
    const now = this.clock();
    const document = this.db.documents.find((d) => d.id === input.documentId);
    const client = document ? this.findRecord(input.organizationId, document.clientId) : undefined;
    if (!document || !client) return { ok: false, denialCode: "DOCUMENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = documentTransition(document.reviewStatus, input.toStatus);
    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "doc.transition_denied",
        targetType: "document",
        targetId: document.id,
        detail: `client ${client.id}: ${document.reviewStatus} → ${input.toStatus} denied`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, emittedEventIds: [] };
    }

    const fromStatus = document.reviewStatus;
    document.reviewStatus = input.toStatus;
    document.updatedAt = now.toISOString();
    client.lastActivityAt = now.toISOString();

    const emitted: DomainEvent[] = [];
    if (input.toStatus === "uploaded") {
      emitted.push(
        createEvent({
          eventType: "DocumentUploaded",
          organizationId: input.organizationId,
          aggregateId: document.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          payload: {
            clientId: client.id,
            documentId: document.id,
            docType: document.docType,
            storageRef: `synthetic://${document.id}`,
          },
        }),
      );
    }
    if (input.toStatus === "approved" || input.toStatus === "needs_attention") {
      emitted.push(
        createEvent({
          eventType: "DocumentReviewed",
          organizationId: input.organizationId,
          aggregateId: document.id,
          actorId: actor.id,
          occurredAt: now.toISOString(),
          payload: {
            clientId: client.id,
            documentId: document.id,
            reviewStatus: input.toStatus,
            reviewedByMemberId: actor.id,
          },
        }),
      );
    }
    for (const event of emitted) {
      this.outbox.push(toOutboxRecord(event, { now }));
    }

    const ACTION_BY_CODE: Record<string, string> = {
      DOC_UPLOADED: "doc.uploaded",
      DOC_REVIEW_STARTED: "doc.review_started",
      DOC_APPROVED: "doc.approved",
      DOC_FLAGGED: "doc.flagged",
      DOC_RESUBMITTED: "doc.resubmitted",
    };
    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: ACTION_BY_CODE[transition.reasonCode] ?? "doc.transitioned",
      targetType: "document",
      targetId: document.id,
      detail: `client ${client.id}: ${fromStatus} → ${input.toStatus} ("${document.name}")`,
      reasonCode: transition.reasonCode,
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, transition, document, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /** Schedule an appointment with the acting staff member. Emits AppointmentScheduled. */
  scheduleAppointment(input: ScheduleAppointmentInput): AppointmentActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const CHANNELS: Appointment["channel"][] = ["video", "phone", "in_person"];
    const purpose = input.purpose.trim();
    const scheduledMs = Date.parse(input.scheduledAt);
    const inputErrors: string[] = [];
    if (purpose.length === 0) inputErrors.push("purpose is required");
    if (!CHANNELS.includes(input.channel)) inputErrors.push(`unknown channel: ${String(input.channel)}`);
    if (Number.isNaN(scheduledMs)) inputErrors.push(`scheduled time is not a valid datetime: ${input.scheduledAt}`);
    else if (scheduledMs <= now.getTime()) inputErrors.push("scheduled time must be in the future");
    if (inputErrors.length > 0) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "appointment.schedule_denied",
        targetType: "appointment",
        targetId: record.id,
        detail: inputErrors.join("; "),
        reasonCode: "AP_INVALID_INPUT",
        ruleVersion: "appointment.v1.0.0",
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors, emittedEventIds: [] };
    }

    this.counter += 1;
    const appointment: Appointment = {
      id: `ap-${record.id}-${this.counter}`,
      clientId: record.id,
      staffId: actor.id,
      purpose,
      scheduledAt: new Date(scheduledMs).toISOString(),
      channel: input.channel,
    };
    this.db.appointments.push(appointment);
    record.lastActivityAt = now.toISOString();

    const event = createEvent({
      eventType: "AppointmentScheduled",
      organizationId: input.organizationId,
      aggregateId: appointment.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        appointmentId: appointment.id,
        staffMemberId: actor.id,
        scheduledAt: appointment.scheduledAt,
        channel: input.channel,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "appointment.scheduled",
      targetType: "appointment",
      targetId: appointment.id,
      detail: `client ${record.id}: "${purpose}" at ${appointment.scheduledAt} (${input.channel})`,
      reasonCode: "AP_SCHEDULED",
      ruleVersion: "appointment.v1.0.0",
      occurredAt: now.toISOString(),
    });

    this.logNotification(
      input.organizationId,
      record,
      "appointment_scheduled",
      { firstName: record.firstName, when: appointment.scheduledAt, advisorName: actor.name },
      now,
    );

    return { ok: true, appointment, emittedEventIds: [event.eventId] };
  }

  /** Append an internal staff note. Audit-only — notes never reach the client portal. */
  addNote(input: AddNoteInput): NoteActionResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND" };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG" };

    const body = input.body.trim();
    if (body.length === 0) {
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors: ["note body is required"] };
    }

    this.counter += 1;
    const note: AdminNote = {
      id: `n-${record.id}-${this.counter}`,
      clientId: record.id,
      staffId: actor.id,
      body,
      createdAt: now.toISOString(),
    };
    this.db.notes.push(note);

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "note.added",
      targetType: "note",
      targetId: note.id,
      detail: `client ${record.id}: note added`,
      reasonCode: "NOTE_ADDED",
      ruleVersion: "note.v1.0.0",
      occurredAt: now.toISOString(),
    });

    return { ok: true, note };
  }

  // --- Secure messaging (messaging.v1.0.0) ------------------------------------
  // Threads and messages are tenant-scoped: every read verifies the thread's
  // organization, and every write authorizes the sender. Internal staff notes
  // live in `notes` (a separate model) and never enter a thread.

  /** Conversation threads for one client, newest-active first. Org-verified. */
  conversationsFor(organizationId: string, clientId: string): ConversationThread[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.conversationThreads
      .filter((t) => t.organizationId === organizationId && t.clientId === clientId)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  }

  /** Raw messages of one thread (staff view), oldest first. Org-verified via the thread. */
  messagesForThread(organizationId: string, threadId: string): Message[] {
    const thread = this.db.conversationThreads.find(
      (t) => t.id === threadId && t.organizationId === organizationId,
    );
    if (!thread) return [];
    return this.db.messages
      .filter((m) => m.threadId === threadId && m.organizationId === organizationId)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  /** Client-portal projection: every thread the client can see, client-safe. */
  clientConversationsFor(organizationId: string, clientId: string): ClientThreadView[] {
    return this.conversationsFor(organizationId, clientId).map((thread) =>
      // Filter on org too (defense-in-depth): this is the client-facing path, so
      // a stray foreign-org message row must never reach the projection.
      toClientThreadView(
        thread,
        this.db.messages.filter((m) => m.threadId === thread.id && m.organizationId === thread.organizationId),
      ),
    );
  }

  /** Staff opens a new thread with an initial message. Rules-gated; audited; emits MessagePosted. */
  openThread(input: OpenThreadInput): ThreadResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const subject = input.subject.trim();
    if (subject.length === 0) {
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors: ["subject is required"], emittedEventIds: [] };
    }
    const validation = validateMessageDraft({ senderId: actor.id, senderRole: "staff", body: input.body }, "open");
    if (!validation.ok || validation.normalizedBody === null) {
      return { ok: false, reasonCode: validation.reasonCode, emittedEventIds: [] };
    }

    this.counter += 1;
    const thread: ConversationThread = {
      id: `th-${record.id}-${this.counter}`,
      organizationId: input.organizationId,
      clientId: record.id,
      subject,
      status: "open",
      createdAt: now.toISOString(),
      lastMessageAt: now.toISOString(),
    };
    this.db.conversationThreads.push(thread);
    const { message, eventId } = this.appendMessage(thread, "staff", actor.id, validation.normalizedBody, now);
    return { ok: true, thread, message, emittedEventIds: [eventId] };
  }

  /** Post a reply to an existing thread (staff or the thread's own client). Rules-gated; audited; emits MessagePosted. */
  postReply(input: PostReplyInput): MessageResult {
    const now = this.clock();
    const thread = this.db.conversationThreads.find(
      (t) => t.id === input.threadId && t.organizationId === input.organizationId,
    );
    if (!thread) return { ok: false, denialCode: "THREAD_NOT_FOUND", emittedEventIds: [] };

    if (input.senderRole === "staff") {
      if (!this.findActor(input.organizationId, input.senderId)) {
        return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };
      }
    } else {
      // A client may only post to their OWN thread, and must be a real client of the org.
      if (input.senderId !== thread.clientId) {
        return { ok: false, denialCode: "NOT_THREAD_CLIENT", emittedEventIds: [] };
      }
      if (!this.findRecord(input.organizationId, thread.clientId)) {
        return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
      }
    }

    const validation = validateMessageDraft(
      { senderId: input.senderId, senderRole: input.senderRole, body: input.body },
      thread.status,
    );
    if (!validation.ok || validation.normalizedBody === null) {
      return { ok: false, reasonCode: validation.reasonCode, emittedEventIds: [] };
    }

    const { message, eventId } = this.appendMessage(thread, input.senderRole, input.senderId, validation.normalizedBody, now);
    return { ok: true, message, emittedEventIds: [eventId] };
  }

  /** Staff closes a thread (open→closed). Rules-gated; audited. */
  closeThread(input: ThreadStatusInput): ThreadResult {
    return this.changeThreadStatus(input, "close");
  }

  /** Staff reopens a thread (closed→open). Rules-gated; audited. */
  reopenThread(input: ThreadStatusInput): ThreadResult {
    return this.changeThreadStatus(input, "reopen");
  }

  private changeThreadStatus(input: ThreadStatusInput, action: ThreadAction): ThreadResult {
    const now = this.clock();
    const thread = this.db.conversationThreads.find(
      (t) => t.id === input.threadId && t.organizationId === input.organizationId,
    );
    if (!thread) return { ok: false, denialCode: "THREAD_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = transitionThread(thread.status, action);
    if (!transition.ok) return { ok: false, reasonCode: transition.reasonCode, thread, emittedEventIds: [] };
    thread.status = transition.status;

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: `message.thread_${action}`,
      targetType: "conversation",
      targetId: thread.id,
      detail: `thread ${thread.id} ${action}d`,
      reasonCode: transition.reasonCode,
      ruleVersion: MESSAGING_RULES_VERSION,
      occurredAt: now.toISOString(),
    });
    return { ok: true, thread, emittedEventIds: [] };
  }

  /**
   * Append a validated message to a thread: persist it, advance thread + client
   * activity, emit MessagePosted (no body in the payload), and audit. Shared by
   * openThread and postReply so both paths behave identically.
   */
  private appendMessage(
    thread: ConversationThread,
    senderRole: MessageSenderRole,
    senderId: string,
    body: string,
    now: Date,
  ): { message: Message; eventId: string } {
    this.counter += 1;
    const iso = now.toISOString();
    const message: Message = {
      id: `msg-${thread.id}-${this.counter}`,
      threadId: thread.id,
      organizationId: thread.organizationId,
      clientId: thread.clientId,
      senderRole,
      senderId,
      body,
      sentAt: iso,
      readByClientAt: senderRole === "client" ? iso : null,
      readByStaffAt: senderRole === "staff" ? iso : null,
    };
    this.db.messages.push(message);
    thread.lastMessageAt = iso;
    const record = this.findRecord(thread.organizationId, thread.clientId);
    if (record) record.lastActivityAt = iso;

    const event = createEvent({
      eventType: "MessagePosted",
      organizationId: thread.organizationId,
      aggregateId: thread.id,
      actorId: senderRole === "staff" ? senderId : null, // a client is not a member actor
      occurredAt: iso,
      payload: { threadId: thread.id, messageId: message.id, clientId: thread.clientId, senderRole },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: thread.organizationId,
      // A client is not a staff/member actor — null here (the thread + the
      // MessagePosted event carry the client identity); staff posts record the member.
      actorStaffId: senderRole === "staff" ? senderId : null,
      action: "message.posted",
      targetType: "conversation",
      targetId: thread.id,
      detail: `thread ${thread.id}: ${senderRole} posted ${message.id}`,
      reasonCode: "MESSAGE_POSTED",
      ruleVersion: MESSAGING_RULES_VERSION,
      occurredAt: iso,
    });

    return { message, eventId: event.eventId };
  }

  /** Goals for one client, primary first, org-verified. */
  goalsFor(organizationId: string, clientId: string): Goal[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.goals
      .filter((g) => g.clientId === clientId)
      .sort((a, b) => (a.isPrimary === b.isPrimary ? 0 : a.isPrimary ? -1 : 1));
  }

  /**
   * Create a goal for a client. Goals are staff-maintained facts (no rule
   * engine); creation is validated, audited, and emits GoalCreated. A goal
   * created as primary demotes any existing primary — exactly one primary.
   */
  createGoal(input: CreateGoalInput): GoalResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const CATEGORIES: Goal["category"][] = ["credit", "savings", "debt", "home_purchase", "business_capital", "other"];
    const title = input.title.trim();
    const inputErrors: string[] = [];
    if (title.length === 0) inputErrors.push("title is required");
    if (!CATEGORIES.includes(input.category)) inputErrors.push(`unknown category: ${String(input.category)}`);
    if (Number.isNaN(Date.parse(input.targetDate))) inputErrors.push(`target date is not valid: ${input.targetDate}`);
    if (inputErrors.length > 0) {
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors, emittedEventIds: [] };
    }

    if (input.isPrimary) {
      for (const g of this.db.goals) if (g.clientId === record.id) g.isPrimary = false;
    }

    this.counter += 1;
    const goal: Goal = {
      id: `g-${record.id}-${this.counter}`,
      clientId: record.id,
      title,
      category: input.category,
      targetDate: new Date(input.targetDate).toISOString().slice(0, 10),
      progressPct: 0,
      isPrimary: input.isPrimary,
    };
    this.db.goals.push(goal);
    record.lastActivityAt = now.toISOString();

    const event = createEvent({
      eventType: "GoalCreated",
      organizationId: input.organizationId,
      aggregateId: goal.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: { clientId: record.id, goalId: goal.id, category: goal.category, isPrimary: goal.isPrimary },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "goal.created",
      targetType: "goal",
      targetId: goal.id,
      detail: `client ${record.id}: "${title}" (${goal.category})${goal.isPrimary ? " — primary" : ""}`,
      reasonCode: "GOAL_CREATED",
      ruleVersion: "goal.v1.0.0",
      occurredAt: now.toISOString(),
    });

    return { ok: true, goal, emittedEventIds: [event.eventId] };
  }

  /** Update a goal's staff-maintained progress (0–100). Audited. */
  updateGoalProgress(input: UpdateGoalProgressInput): GoalResult {
    const now = this.clock();
    const goal = this.db.goals.find((g) => g.id === input.goalId);
    const client = goal ? this.findRecord(input.organizationId, goal.clientId) : undefined;
    if (!goal || !client) return { ok: false, denialCode: "GOAL_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    if (!Number.isFinite(input.progressPct) || input.progressPct < 0 || input.progressPct > 100) {
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors: ["progress must be between 0 and 100"], emittedEventIds: [] };
    }

    const from = goal.progressPct;
    goal.progressPct = Math.round(input.progressPct);
    client.lastActivityAt = now.toISOString();

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "goal.progress_updated",
      targetType: "goal",
      targetId: goal.id,
      detail: `client ${client.id}: ${from}% → ${goal.progressPct}%`,
      reasonCode: "GOAL_PROGRESS",
      ruleVersion: "goal.v1.0.0",
      occurredAt: now.toISOString(),
    });

    return { ok: true, goal, emittedEventIds: [] };
  }

  /** Make a goal the client's primary, demoting the others. Audited. */
  setPrimaryGoal(input: SetPrimaryGoalInput): GoalResult {
    const now = this.clock();
    const goal = this.db.goals.find((g) => g.id === input.goalId);
    const client = goal ? this.findRecord(input.organizationId, goal.clientId) : undefined;
    if (!goal || !client) return { ok: false, denialCode: "GOAL_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    for (const g of this.db.goals) if (g.clientId === client.id) g.isPrimary = g.id === goal.id;
    client.lastActivityAt = now.toISOString();

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "goal.set_primary",
      targetType: "goal",
      targetId: goal.id,
      detail: `client ${client.id}: "${goal.title}" is now primary`,
      reasonCode: "GOAL_PRIMARY",
      ruleVersion: "goal.v1.0.0",
      occurredAt: now.toISOString(),
    });

    return { ok: true, goal, emittedEventIds: [] };
  }

  /** ΛFLO Wealth Academy assignments for one client, newest first, org-verified. */
  educationFor(organizationId: string, clientId: string): EducationAssignment[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.educationAssignments
      .filter((e) => e.clientId === clientId)
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  }

  /**
   * Assign a lesson from a deterministic trigger (education.v1.0.0). Records
   * full provenance (trigger, rule version, reason code, content version) and
   * emits EducationAssigned. Idempotent per (client, lesson, trigger) while an
   * assignment is still open — the same trigger never stacks duplicates.
   */
  assignEducation(input: {
    organizationId: string;
    clientId: string;
    trigger: EducationTrigger;
    actorStaffId: string;
  }): { ok: boolean; denialCode?: "CLIENT_NOT_FOUND" | "ACTOR_NOT_IN_ORG"; assignment?: EducationAssignment; emittedEventIds: string[] } {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const selection = selectEducation(input.trigger);
    const existing = this.db.educationAssignments.find(
      (e) => e.clientId === record.id && e.lessonId === selection.lessonId && e.completedAt === null,
    );
    if (existing) {
      // Already assigned and open — return it without a duplicate event.
      return { ok: true, assignment: existing, emittedEventIds: [] };
    }

    const lesson = getLesson(ACADEMY_LIBRARY, selection.lessonId);
    this.counter += 1;
    const assignment: EducationAssignment = {
      id: `edu-${record.id}-${this.counter}`,
      clientId: record.id,
      lessonId: selection.lessonId,
      contentVersion: lesson?.contentVersion ?? "unknown",
      trigger: selection.trigger,
      reasonCode: selection.reasonCode,
      ruleVersion: selection.ruleVersion,
      assignedAt: now.toISOString(),
      completedAt: null,
      knowledgeCheckScore: null,
      staffReviewStatus: "not_required",
    };
    this.db.educationAssignments.push(assignment);

    const event = createEvent({
      eventType: "EducationAssigned",
      organizationId: input.organizationId,
      aggregateId: assignment.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        assignmentId: assignment.id,
        moduleId: selection.lessonId,
        trigger: selection.trigger,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "education.assigned",
      targetType: "education_assignment",
      targetId: assignment.id,
      detail: `client ${record.id}: "${lesson?.title ?? selection.lessonId}" (${selection.trigger})`,
      reasonCode: selection.reasonCode,
      ruleVersion: selection.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, assignment, emittedEventIds: [event.eventId] };
  }

  /**
   * Complete an education assignment, scoring the knowledge check if the
   * lesson has one (deterministic). Emits EducationCompleted. Academy
   * completion is educational only — it never gates a regulated product.
   */
  completeEducation(input: {
    organizationId: string;
    assignmentId: string;
    correct?: number;
    total?: number;
    actorStaffId: string;
  }): { ok: boolean; denialCode?: "ASSIGNMENT_NOT_FOUND" | "ACTOR_NOT_IN_ORG" | "ALREADY_COMPLETED"; assignment?: EducationAssignment; emittedEventIds: string[] } {
    const now = this.clock();
    const assignment = this.db.educationAssignments.find((e) => e.id === input.assignmentId);
    const client = assignment ? this.findRecord(input.organizationId, assignment.clientId) : undefined;
    if (!assignment || !client) return { ok: false, denialCode: "ASSIGNMENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };
    if (assignment.completedAt !== null) {
      return { ok: false, denialCode: "ALREADY_COMPLETED", assignment, emittedEventIds: [] };
    }

    const lesson = getLesson(ACADEMY_LIBRARY, assignment.lessonId);
    let score: number | null = null;
    if (lesson?.knowledgeCheck && typeof input.correct === "number" && typeof input.total === "number") {
      score = scoreKnowledgeCheck(input.correct, input.total, lesson.knowledgeCheck.passThreshold).score;
    }
    assignment.completedAt = now.toISOString();
    assignment.knowledgeCheckScore = score;
    client.lastActivityAt = now.toISOString();

    const event = createEvent({
      eventType: "EducationCompleted",
      organizationId: input.organizationId,
      aggregateId: assignment.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: client.id,
        assignmentId: assignment.id,
        moduleId: assignment.lessonId,
        knowledgeCheckScore: score,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "education.completed",
      targetType: "education_assignment",
      targetId: assignment.id,
      detail: `client ${client.id}: "${lesson?.title ?? assignment.lessonId}"${
        score !== null ? ` (knowledge check ${Math.round(score * 100)}%)` : ""
      }`,
      reasonCode: "EDU_COMPLETED",
      ruleVersion: assignment.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, assignment, emittedEventIds: [event.eventId] };
  }

  /** Round-up simulator settings for one client, org-verified. */
  simulationFor(organizationId: string, clientId: string): SimulationSettings | null {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return null;
    return this.db.simulationSettings.find((s) => s.clientId === clientId) ?? null;
  }

  /** Hypothetical transactions for one client, newest first, org-verified. */
  virtualTransactionsFor(organizationId: string, clientId: string): VirtualTransaction[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.virtualTransactions
      .filter((t) => t.clientId === clientId)
      .sort((a, b) => b.occurredOn.localeCompare(a.occurredOn));
  }

  /**
   * Configure the round-up simulator for a client (simulation only — never
   * moves money). Creates settings on first use. Validated and audited.
   */
  configureSimulation(input: ConfigureSimulationInput): SimulationResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND" };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG" };

    const inputErrors: string[] = [];
    if (!Number.isInteger(input.roundToCents) || input.roundToCents <= 0) {
      inputErrors.push("round-up boundary must be a positive whole number of cents");
    }
    if (!Number.isFinite(input.multiplier) || input.multiplier <= 0) {
      inputErrors.push("multiplier must be positive");
    }
    if (inputErrors.length > 0) {
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors };
    }

    let settings = this.db.simulationSettings.find((s) => s.clientId === record.id);
    if (settings) {
      settings.roundToCents = input.roundToCents;
      settings.multiplier = input.multiplier;
      settings.enabled = input.enabled;
    } else {
      settings = {
        clientId: record.id,
        roundToCents: input.roundToCents,
        multiplier: input.multiplier,
        enabled: input.enabled,
      };
      this.db.simulationSettings.push(settings);
    }

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "simulation.configured",
      targetType: "simulation",
      targetId: record.id,
      detail: `round to ${input.roundToCents}c × ${input.multiplier}, ${input.enabled ? "enabled" : "disabled"}`,
      reasonCode: "SIM_CONFIGURED",
      ruleVersion: ROUNDUP_RULES_VERSION,
      occurredAt: now.toISOString(),
    });

    return { ok: true, settings };
  }

  /**
   * Add a hypothetical transaction; its round-up is computed by the rule so
   * the stored value can never disagree with the calculator. Simulation only.
   */
  addVirtualTransaction(input: AddVirtualTransactionInput): SimulationResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND" };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG" };

    const label = input.label.trim();
    const inputErrors: string[] = [];
    if (label.length === 0) inputErrors.push("label is required");
    if (!Number.isFinite(input.amountCents) || input.amountCents <= 0) {
      inputErrors.push("amount must be positive");
    }
    if (Number.isNaN(Date.parse(input.occurredOn))) {
      inputErrors.push(`date is not valid: ${input.occurredOn}`);
    }
    if (inputErrors.length > 0) {
      return { ok: false, denialCode: "INVALID_INPUT", inputErrors };
    }

    const settings =
      this.db.simulationSettings.find((s) => s.clientId === record.id) ??
      ({ clientId: record.id, roundToCents: 100, multiplier: 1, enabled: true } as SimulationSettings);
    if (!this.db.simulationSettings.includes(settings)) this.db.simulationSettings.push(settings);

    this.counter += 1;
    const transaction: VirtualTransaction = {
      id: `vt-${record.id}-${this.counter}`,
      clientId: record.id,
      label,
      amountCents: Math.round(input.amountCents),
      roundUpAmountCents: roundUpAmountCents(
        Math.round(input.amountCents),
        settings.roundToCents,
        settings.multiplier,
      ),
      occurredOn: new Date(input.occurredOn).toISOString().slice(0, 10),
    };
    this.db.virtualTransactions.push(transaction);

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "simulation.transaction_added",
      targetType: "simulation",
      targetId: record.id,
      detail: `"${label}" ${transaction.amountCents}c → round-up ${transaction.roundUpAmountCents}c`,
      reasonCode: "SIM_TXN_ADDED",
      ruleVersion: ROUNDUP_RULES_VERSION,
      occurredAt: now.toISOString(),
    });

    return { ok: true, settings, transaction };
  }

  /** Recorded assessment history for one client, oldest first, org-verified. */
  assessmentsFor(organizationId: string, clientId: string): ReadinessAssessmentRecord[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.assessments.filter((a) => a.clientId === clientId);
  }

  /**
   * The governed Financial Resolution Concierge readout (understand → diagnose
   * → organize) for one client. A pure READ: it composes already-recorded
   * facts via `buildResolutionReadout` and mutates nothing, emits no event, and
   * writes no audit. Fail-closed org scope — an unknown or foreign-org client
   * returns null. The diagnosis mirrors the latest *recorded* assessment
   * verbatim; it is never re-run here.
   */
  resolutionReadoutFor(
    organizationId: string,
    clientId: string,
    now: Date = this.clock(),
  ): ResolutionReadout | null {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return null;

    const intake = this.db.intakes.find((i) => i.clientId === record.id);
    return buildResolutionReadout({
      clientId: record.id,
      financial: this.db.financialProfiles.find((p) => p.clientId === record.id) ?? null,
      credit: this.db.creditProfiles.find((p) => p.clientId === record.id) ?? null,
      latestAssessment: this.db.assessments.filter((a) => a.clientId === record.id).at(-1) ?? null,
      intakeComplete: intake?.status === "completed",
      engagement: assessEngagement(record.lastActivityAt, now),
      primaryGoal: this.db.goals.find((g) => g.clientId === record.id && g.isPrimary) ?? null,
      documents: this.db.documents.filter((d) => d.clientId === record.id),
      now,
    });
  }

  /**
   * A DISPLAY-ONLY credit-report summary for staff, from the provider-neutral
   * credit-data seam. A pure READ that:
   *   - fails closed on org scope (unknown/foreign-org client → null);
   *   - is CONSENT-GATED on `data_processing` (absent consent → unavailable,
   *     not the data);
   *   - routes through the provider (the synthetic mock in V1 — `isProduction`
   *     is always false, no bureau) and deterministically summarizes the report;
   *   - mutates NOTHING, emits no event, writes no audit, and NEVER updates the
   *     manual `CreditProfile` or the readiness inputs. Reported data here is
   *     unverified; staff must verify before relying on it.
   */
  async creditReportSummaryFor(
    organizationId: string,
    clientId: string,
    now: Date = this.clock(),
  ): Promise<CreditReportSummary | null> {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return null;

    const base = {
      clientId: record.id,
      isProduction: false,
      source: null,
      pulledAt: null,
      facts: null,
      staffVerified: false as const,
    };

    if (!hasActiveConsent(this.db.consentRecords, record.id, "data_processing")) {
      return { ...base, available: false, reason: "consent_required" };
    }

    let report: NormalizedCreditReport;
    try {
      report = await this.creditProvider.fetchReport({
        subjectRef: record.id,
        purpose: "consumer_disclosure",
        requestedAt: now.toISOString(),
      });
    } catch (error) {
      if (error instanceof UnknownSubjectError) {
        return { ...base, available: false, reason: "no_report" };
      }
      throw error;
    }

    return {
      clientId: record.id,
      available: true,
      reason: null,
      // Mirrors the provider — false for the mock, and for every provider in V1.
      isProduction: this.creditProvider.info().isProduction,
      source: report.source,
      pulledAt: report.pulledAt,
      facts: summarizeCreditReport(report, now),
      staffVerified: false,
    };
  }

  /**
   * Public opportunity notices worth surfacing for one client — a pure READ
   * over `@aflo/opportunity-intelligence`. It runs `matchNoticeToProfile`
   * against the client's goal categories and jurisdiction (federal by default —
   * the client's state is not captured yet, so state programs stay unsurfaced,
   * fail-closed), keeps only `relevant` notices, and renders each via
   * `toClientSafeSummary`. Legal/claims notices (`requiresReview`) carry a NULL
   * `clientSafe` — they are shown to staff but never auto-projected to a client
   * (roadmap §4 human-review gate). A notice that cannot render client-safe is
   * dropped (fail closed). Mutates nothing, emits no event, writes no audit.
   */
  opportunityNoticesFor(
    organizationId: string,
    clientId: string,
    now: Date = this.clock(),
    jurisdiction = "US",
  ): ClientOpportunity[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];

    const goalCategories = this.db.goals.filter((g) => g.clientId === record.id).map((g) => g.category);
    const signals = { jurisdiction, goalCategories, now };

    const surfaced: ClientOpportunity[] = [];
    for (const notice of OPPORTUNITY_REGISTRY) {
      const match = matchNoticeToProfile(notice, signals);
      if (!match.relevant) continue;

      const base = {
        noticeId: notice.id,
        category: notice.category,
        title: notice.title,
        reasonCodes: match.reasonCodes,
        requiresReview: match.requiresReview,
        sourceUrl: notice.citation.url,
      };

      if (match.requiresReview) {
        // Legal/claims: shown to staff, never client-projected without approval.
        surfaced.push({ ...base, clientSafe: null });
        continue;
      }
      try {
        surfaced.push({ ...base, clientSafe: toClientSafeSummary(notice) });
      } catch {
        // Fail closed: a notice that cannot render client-safe is not surfaced.
      }
    }
    return surfaced;
  }

  /**
   * Run the deterministic readiness rules over the client's verified
   * profiles and record the result. Eligibility requires a completed intake
   * (facts are captured there); an attempt without the needed profiles is
   * audited as blocked, never recorded. The review gate (review.v1.0.0)
   * flags regressions and multi-stage advances for staff — deterministically,
   * never via AI.
   */
  runReadinessAssessment(input: RunAssessmentInput): AssessmentResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const intake = this.db.intakes.find((i) => i.clientId === record.id);
    if (!intake || intake.status !== "completed") {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "readiness.assessment_denied",
        targetType: "readiness_assessment",
        targetId: record.id,
        detail: intake ? "intake not yet completed" : "intake not started",
        reasonCode: "INTAKE_NOT_COMPLETED",
        ruleVersion: INTAKE_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "INTAKE_NOT_COMPLETED", emittedEventIds: [] };
    }

    const financial = this.db.financialProfiles.find((p) => p.clientId === record.id);
    const credit = this.db.creditProfiles.find((p) => p.clientId === record.id);
    if (!financial || !credit) {
      const missingFacts = [
        ...(financial ? [] : ["financial_profile"]),
        ...(credit ? [] : ["credit_profile"]),
      ];
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "readiness.assessment_blocked",
        targetType: "readiness_assessment",
        targetId: record.id,
        detail: `missing verified facts: ${missingFacts.join(", ")}`,
        reasonCode: "FACTS_MISSING",
        ruleVersion: READINESS_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "MISSING_FACTS", missingFacts, emittedEventIds: [] };
    }

    const assessment = assessReadiness(toReadinessFacts(financial, credit));
    const previous = this.db.assessments.filter((a) => a.clientId === record.id).at(-1) ?? null;
    const review = assessmentReviewGate(previous?.stage ?? null, assessment.stage);
    const bindingBlocker = assessment.reasonCodes[0];

    this.counter += 1;
    const assessmentRecord: ReadinessAssessmentRecord = {
      id: `ra-${record.id}-${this.counter}`,
      clientId: record.id,
      stage: assessment.stage,
      previousStage: previous?.stage ?? null,
      ruleVersion: assessment.ruleVersion,
      reasonCodes: assessment.reasonCodes,
      factsUsed: assessment.factsUsed,
      proposedNextAction: bindingBlocker ? REASON_CODE_NEXT_ACTIONS[bindingBlocker] : "",
      requiresHumanReview: review.requiresHumanReview,
      reviewReasonCodes: review.reasonCodes,
      assessedAt: now.toISOString(),
      actorStaffId: actor.id,
    };
    this.db.assessments.push(assessmentRecord);

    const event = createEvent({
      eventType: "ReadinessAssessed",
      organizationId: input.organizationId,
      aggregateId: assessmentRecord.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        assessmentId: assessmentRecord.id,
        stage: assessment.stage,
        previousStage: previous?.stage ?? null,
        ruleVersion: assessment.ruleVersion,
        reasonCodes: assessment.reasonCodes,
        requiresHumanReview: review.requiresHumanReview,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "readiness.assessed",
      targetType: "readiness_assessment",
      targetId: record.id,
      detail: `stage ${assessment.stage}${previous ? ` (was ${previous.stage})` : ""}${
        review.requiresHumanReview ? ` — review required: ${review.reasonCodes.join(", ")}` : ""
      }`,
      reasonCode: bindingBlocker ?? "RC_ALL_ACQUISITION_GATES_MET",
      ruleVersion: assessment.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, record: assessmentRecord, review, emittedEventIds: [event.eventId] };
  }

  /** The forward stage a lead should reach next (UI "next action"). */
  nextStageFor(organizationId: string, leadId: string) {
    const record = this.findRecord(organizationId, leadId);
    if (!record) return null;
    return nextRequiredStage(this.db.pipeline, record.pipelineStageId);
  }

  /** The organization's active partner directory (org-verified). */
  partnersFor(organizationId: string) {
    return this.db.partners.filter((p) => p.organizationId === organizationId && p.active);
  }

  /** Tracked referrals for one client, org-verified, newest first. */
  referralsFor(organizationId: string, clientId: string): PartnerReferral[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.partnerReferrals
      .filter((r) => r.organizationId === organizationId && r.clientId === clientId)
      .slice()
      .reverse();
  }

  /**
   * Create a tracked partner referral (partner.v1.0.0). Fails closed on a
   * server-verified actor, an active partner in the org, and — the guardrail —
   * a COMPLETE eight-field neutrality record (ADR-0007 §3). AFLO records that
   * it routed the client to a licensed partner; it never approves or guarantees
   * an outcome, and partner compensation never touches readiness. Emits
   * PartnerReferralCreated; denials are audited and never mutate.
   */
  createReferral(input: CreateReferralInput): ReferralResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const partner = this.db.partners.find(
      (p) => p.id === input.partnerId && p.organizationId === input.organizationId,
    );
    if (!partner) return { ok: false, denialCode: "PARTNER_NOT_FOUND", emittedEventIds: [] };
    if (!partner.active) return { ok: false, denialCode: "PARTNER_INACTIVE", emittedEventIds: [] };

    const neutrality = validateNeutralityRecord(input.neutrality);
    if (!neutrality.complete) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "partner_referral.denied",
        targetType: "referral",
        targetId: record.id,
        detail: `neutrality record incomplete for partner ${partner.id}: missing ${neutrality.missingFields.join(", ")}`,
        reasonCode: neutrality.reasonCode,
        ruleVersion: neutrality.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return {
        ok: false,
        denialCode: "NEUTRALITY_INCOMPLETE",
        missingNeutralityFields: neutrality.missingFields,
        emittedEventIds: [],
      };
    }

    this.counter += 1;
    const referral: PartnerReferral = {
      id: `pr-${record.id}-${this.counter}`,
      organizationId: input.organizationId,
      clientId: record.id,
      partnerId: partner.id,
      status: "suggested",
      neutrality: input.neutrality,
      outcome: null,
      outcomeNote: null,
      createdByStaffId: actor.id,
      createdAt: now.toISOString(),
      sharedAt: null,
      updatedAt: now.toISOString(),
    };
    this.db.partnerReferrals.push(referral);

    const event = createEvent({
      eventType: "PartnerReferralCreated",
      organizationId: input.organizationId,
      aggregateId: referral.id,
      actorId: actor.id,
      occurredAt: now.toISOString(),
      payload: {
        clientId: record.id,
        referralId: referral.id,
        partnerId: partner.id,
        neutralityRecordId: `${referral.id}-neutrality`,
      },
    });
    this.outbox.push(toOutboxRecord(event, { now }));

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "partner_referral.created",
      targetType: "referral",
      targetId: referral.id,
      detail: `client ${record.id} → ${partner.category} partner ${partner.id}${
        partner.nonCommercial ? " (non-commercial)" : ""
      }; staff-reviewed neutrality`,
      reasonCode: "PR_CREATED",
      ruleVersion: PARTNER_RULES_VERSION,
      occurredAt: now.toISOString(),
    });

    return { ok: true, referral, emittedEventIds: [event.eventId] };
  }

  /**
   * Move a referral through its lifecycle (partner.v1.0.0), except into
   * `outcome_recorded` (use recordReferralOutcome). The rule validates the
   * transition; denials are audited and never mutate.
   */
  transitionReferral(input: TransitionReferralInput): ReferralResult {
    const now = this.clock();
    const referral = this.db.partnerReferrals.find(
      (r) => r.id === input.referralId && r.organizationId === input.organizationId,
    );
    if (!referral) return { ok: false, denialCode: "REFERRAL_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = partnerReferralTransition(referral.status, input.toStatus);
    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "partner_referral.transition_denied",
        targetType: "referral",
        targetId: referral.id,
        detail: `${referral.status} → ${input.toStatus} denied`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, emittedEventIds: [] };
    }

    const fromStatus = referral.status;
    referral.status = input.toStatus;
    referral.updatedAt = now.toISOString();
    if (input.toStatus === "shared_with_client" && !referral.sharedAt) {
      referral.sharedAt = now.toISOString();
    }

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "partner_referral.transitioned",
      targetType: "referral",
      targetId: referral.id,
      detail: `client ${referral.clientId}: ${fromStatus} → ${input.toStatus}`,
      reasonCode: transition.reasonCode,
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, transition, referral, emittedEventIds: [] };
  }

  /**
   * Record a staff-observed outcome and move the referral to
   * `outcome_recorded` (partner.v1.0.0). The outcome is an observation, never
   * an approval — AFLO does not decide a partner's result. Rule-gated and
   * audited.
   */
  recordReferralOutcome(input: RecordReferralOutcomeInput): ReferralResult {
    const now = this.clock();
    const referral = this.db.partnerReferrals.find(
      (r) => r.id === input.referralId && r.organizationId === input.organizationId,
    );
    if (!referral) return { ok: false, denialCode: "REFERRAL_NOT_FOUND", emittedEventIds: [] };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG", emittedEventIds: [] };

    const transition = partnerReferralTransition(referral.status, "outcome_recorded");
    if (!transition.allowed) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "partner_referral.transition_denied",
        targetType: "referral",
        targetId: referral.id,
        detail: `${referral.status} → outcome_recorded denied`,
        reasonCode: transition.reasonCode,
        ruleVersion: transition.ruleVersion,
        occurredAt: now.toISOString(),
      });
      return { ok: false, transition, emittedEventIds: [] };
    }

    referral.status = "outcome_recorded";
    referral.outcome = input.outcome;
    referral.outcomeNote = input.note?.trim() ? input.note.trim() : null;
    referral.updatedAt = now.toISOString();

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "partner_referral.outcome_recorded",
      targetType: "referral",
      targetId: referral.id,
      detail: `client ${referral.clientId}: outcome ${input.outcome}`,
      reasonCode: "PR_OUTCOME",
      ruleVersion: transition.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, transition, referral, emittedEventIds: [] };
  }

  /** Signed handoff packages issued for one client, org-verified, newest last. */
  handoffPackagesFor(organizationId: string, clientId: string): HandoffPackage[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.handoffPackages.filter(
      (p) => p.organizationId === organizationId && p.clientId === clientId,
    );
  }

  /**
   * Assemble and sign a verification handoff package (security.v1.0.0) from a
   * client's VERIFIED facts. Fails closed on three gates: a server-verified
   * actor, active `partner_data_sharing` consent, and at least one recorded
   * readiness assessment. The payload carries the ΛFLO readiness stage (never a
   * bureau score), the primary goal, the count of staff-approved documents, and
   * the latest published report quarter — no raw SSN, bank, or credit-report
   * data. The signature binds that payload to the store's key; a recipient can
   * detect any later tampering. Denials are audited and never mutate.
   */
  generateHandoffPackage(input: GenerateHandoffInput): HandoffResult {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND" };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG" };

    // Consent gate: an external share requires active partner-data-sharing
    // consent. Absent or revoked consent fails closed (audited, no package).
    if (!hasActiveConsent(this.db.consentRecords, record.id, "partner_data_sharing")) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "handoff.generate_denied",
        targetType: "handoff_package",
        targetId: record.id,
        detail: `no active partner_data_sharing consent for ${record.id}`,
        reasonCode: "NO_PARTNER_CONSENT",
        ruleVersion: NOTIFICATION_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "NO_PARTNER_CONSENT" };
    }

    // A handoff asserts a verified readiness position; there must be one to assert.
    const assessment = this.db.assessments.filter((a) => a.clientId === record.id).at(-1);
    if (!assessment) {
      this.audit({
        organizationId: input.organizationId,
        actorStaffId: actor.id,
        action: "handoff.generate_denied",
        targetType: "handoff_package",
        targetId: record.id,
        detail: `no recorded readiness assessment for ${record.id}`,
        reasonCode: "NO_VERIFIED_ASSESSMENT",
        ruleVersion: READINESS_RULES_VERSION,
        occurredAt: now.toISOString(),
      });
      return { ok: false, denialCode: "NO_VERIFIED_ASSESSMENT" };
    }

    const primaryGoal = this.db.goals.find((g) => g.clientId === record.id && g.isPrimary) ?? null;
    const approvedDocumentCount = this.db.documents.filter(
      (d) => d.clientId === record.id && d.reviewStatus === "approved",
    ).length;
    const latestPublishedReport = this.db.reports
      .filter((r) => r.clientId === record.id && r.status === "published")
      .at(-1);
    const latestConsent = this.db.consentRecords
      .filter((c) => c.userId === record.id && c.consentType === "partner_data_sharing")
      .at(-1);

    // The signed content: verified facts only. The readiness stage is the ΛFLO
    // deterministic lifecycle stage — explicitly NOT a credit-bureau score.
    const payload: HandoffFacts = {
      subjectName: `${record.firstName} ${record.lastName}`,
      issuingOrganization: this.db.organization.name,
      afloReadinessStage: assessment.stage,
      afloReadinessStageLabel: LIFECYCLE_STAGE_LABELS[assessment.stage],
      readinessIsBureauScore: false,
      readinessRuleVersion: assessment.ruleVersion,
      readinessAssessedAt: assessment.assessedAt,
      primaryGoal: primaryGoal ? { title: primaryGoal.title, category: primaryGoal.category } : null,
      verifiedDocumentCount: approvedDocumentCount,
      latestPublishedReportQuarter: latestPublishedReport?.quarter ?? null,
    };

    this.counter += 1;
    const expiresAt = new Date(now.getTime() + HANDOFF_VALIDITY_DAYS * 24 * 60 * 60 * 1000);
    const pkg = assembleHandoffPackage({
      id: `hp-${record.id}-${this.counter}`,
      organizationId: input.organizationId,
      clientId: record.id,
      recipientScope: input.recipientScope,
      consentScope: `partner_data_sharing@${latestConsent?.recordedAt ?? now.toISOString()}`,
      payload,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      keyId: this.signingKey.keyId,
      privateKeyPem: this.signingKey.privateKeyPem,
    });
    this.db.handoffPackages.push(pkg);

    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "handoff.generated",
      targetType: "handoff_package",
      targetId: pkg.id,
      detail: `client ${record.id} → ${input.recipientScope}; digest ${pkg.payloadDigest.slice(0, 16)}…; key ${pkg.keyId}; expires ${pkg.expiresAt}`,
      reasonCode: "HANDOFF_ISSUED",
      ruleVersion: pkg.ruleVersion,
      occurredAt: now.toISOString(),
    });

    return { ok: true, package: pkg };
  }

  /**
   * Verify a stored handoff package by id (security.v1.0.0). Pure read: checks
   * revocation, digest, key, signature, and expiry against the store's key and
   * clock, returning a specific verdict. Fails closed; never mutates or audits.
   */
  verifyHandoffPackageById(
    organizationId: string,
    packageId: string,
  ): HandoffVerification | { ok: false; verdict: "PACKAGE_NOT_FOUND" } {
    const pkg = this.db.handoffPackages.find(
      (p) => p.id === packageId && p.organizationId === organizationId,
    );
    if (!pkg) return { ok: false, verdict: "PACKAGE_NOT_FOUND" };
    return verifyHandoffPackage(
      pkg,
      (keyId) => (keyId === this.signingKey.keyId ? this.signingKey.publicKeyPem : null),
      this.clock(),
    );
  }

  /**
   * Revoke a handoff package (security.v1.0.0). Revocation is a one-way state
   * change — a revoked package verifies as REVOKED before any other check. Re-
   * revoking is denied. Audited; org/actor scoped.
   */
  revokeHandoffPackage(input: RevokeHandoffInput): HandoffResult {
    const now = this.clock();
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG" };
    const pkg = this.db.handoffPackages.find(
      (p) => p.id === input.packageId && p.organizationId === input.organizationId,
    );
    if (!pkg) return { ok: false, denialCode: "PACKAGE_NOT_FOUND" };
    if (pkg.revokedAt !== null) return { ok: false, denialCode: "ALREADY_REVOKED", package: pkg };

    pkg.revokedAt = now.toISOString();
    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "handoff.revoked",
      targetType: "handoff_package",
      targetId: pkg.id,
      detail: `client ${pkg.clientId}; digest ${pkg.payloadDigest.slice(0, 16)}… revoked`,
      reasonCode: "HANDOFF_REVOKED",
      ruleVersion: pkg.ruleVersion,
      occurredAt: now.toISOString(),
    });
    return { ok: true, package: pkg };
  }

  private findRecord(organizationId: string, id: string): ClientRecord | undefined {
    return this.db.clients.find((c) => c.id === id && c.organizationId === organizationId);
  }

  private findActor(organizationId: string, staffId: string) {
    return this.db.staff.find((s) => s.id === staffId && s.organizationId === organizationId);
  }

  /** Recorded communications for one client, oldest first, org-verified. */
  communicationsFor(organizationId: string, clientId: string): CommunicationLogEntry[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.communicationsLog.filter(
      (c) => c.organizationId === organizationId && c.clientId === clientId,
    );
  }

  /**
   * Plan and record an outbound communication triggered by a workflow event.
   * The consent gate (notification.v1.0.0) runs before any content is
   * rendered; suppressed communications are recorded with their reason and
   * carry no content. In dev/preview a queued communication is recorded as
   * mock-delivered ("sent"); real async provider dispatch with retries is the
   * worker slice. The recipient id in the prototype is the client id.
   */
  private logNotification<T extends NotificationType>(
    organizationId: string,
    client: ClientRecord,
    type: T,
    vars: NotificationVarsMap[T],
    now: Date,
  ): void {
    // Preferences + consent are enforced BEFORE any content is rendered:
    // resolveDelivery decides, per default channel, whether it may send.
    const deliveries = resolveDelivery(
      type,
      client.id,
      this.db.notificationPreferences,
      this.db.consentRecords,
    );
    const willSend = deliveries.some((d) => d.willSend);
    const message = willSend ? renderNotification(type, vars) : null;

    for (const d of deliveries) {
      this.counter += 1;
      this.communicationsLog.push({
        id: `comm-${this.counter}`,
        organizationId,
        clientId: client.id,
        notificationType: type,
        channel: d.channel,
        status: d.willSend ? "sent" : "suppressed",
        subject: d.willSend ? message!.subject : null,
        suppressionReason: d.reason,
        occurredAt: now.toISOString(),
      });
    }

    const sent = deliveries.filter((d) => d.willSend).map((d) => d.channel);
    const withheld = deliveries.filter((d) => !d.willSend);
    this.audit({
      organizationId,
      actorStaffId: "system",
      action: willSend ? "comm.sent" : "comm.suppressed",
      targetType: "communication",
      targetId: client.id,
      detail: `${type}: sent [${sent.join(", ") || "none"}]${
        withheld.length > 0 ? `, withheld [${withheld.map((d) => `${d.channel}:${d.reason}`).join(", ")}]` : ""
      }`,
      reasonCode: willSend ? "SENT" : withheld[0]?.reason ?? "SUPPRESSED",
      ruleVersion: NOTIFICATION_RULES_VERSION,
      occurredAt: now.toISOString(),
    });
  }

  /** Notification preferences for one recipient, org-verified. */
  notificationPreferencesFor(organizationId: string, clientId: string) {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.notificationPreferences.filter((p) => p.userId === clientId);
  }

  /**
   * Set a notification-channel preference for a recipient (append-only,
   * latest-wins). Granular per (type, channel), revocable, audited, and
   * org/actor scoped. Enforced on the next send via resolveDelivery.
   */
  setNotificationPreference(input: {
    organizationId: string;
    clientId: string;
    notificationType: NotificationType;
    channel: NotificationChannel;
    enabled: boolean;
    actorStaffId: string;
  }): { ok: boolean; denialCode?: "CLIENT_NOT_FOUND" | "ACTOR_NOT_IN_ORG" } {
    const now = this.clock();
    const record = this.findRecord(input.organizationId, input.clientId);
    if (!record) return { ok: false, denialCode: "CLIENT_NOT_FOUND" };
    const actor = this.findActor(input.organizationId, input.actorStaffId);
    if (!actor) return { ok: false, denialCode: "ACTOR_NOT_IN_ORG" };

    this.db.notificationPreferences.push({
      userId: record.id,
      notificationType: input.notificationType,
      channel: input.channel,
      enabled: input.enabled,
      recordedAt: now.toISOString(),
    });
    this.audit({
      organizationId: input.organizationId,
      actorStaffId: actor.id,
      action: "notification_preference.set",
      targetType: "notification_preference",
      targetId: record.id,
      detail: `${input.notificationType}/${input.channel} ${input.enabled ? "enabled" : "disabled"}`,
      reasonCode: input.enabled ? "PREF_ENABLED" : "PREF_DISABLED",
      ruleVersion: NOTIFICATION_RULES_VERSION,
      occurredAt: now.toISOString(),
    });
    return { ok: true };
  }

  private audit(entry: Omit<AuditEntry, "id">): void {
    this.counter += 1;
    this.auditLog.push({ id: `audit-${this.counter}`, ...entry });
  }
}
