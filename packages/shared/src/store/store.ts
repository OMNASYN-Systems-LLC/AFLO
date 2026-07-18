import {
  ACTION_RULES_VERSION,
  INTAKE_RULES_VERSION,
  LIFECYCLE_STAGE_LABELS,
  PIPELINE_BACKBONE,
  READINESS_RULES_VERSION,
  REASON_CODE_NEXT_ACTIONS,
  REPORT_RULES_VERSION,
  actionTransition,
  assessReadiness,
  assessmentReviewGate,
  intakeCompleteness,
  nextRequiredStage,
  pipelineTransition,
  quarterMonths,
  quarterOf,
  reportTransition,
  roadmapTransition,
  sectionCompletion,
  type ActionStatusId,
  type ActionTransitionResult,
  type IntakeCompletenessResult,
  type PipelineTransitionResult,
  type ReportStatusId,
  type ReportTransitionResult,
  type ReviewGateResult,
  type RoadmapStatus,
  type RoadmapTransitionResult,
} from "@aflo/rules";
import { createEvent, type DomainEvent } from "../events";
import { toOutboxRecord, type OutboxRecord } from "../outbox";
import { syntheticDatabase, type SyntheticDatabase } from "../data/synthetic";
import { toReadinessFacts } from "../domain/facts";
import type {
  ClientRecord,
  IntakeRecord,
  MonthlyAction,
  QuarterlyReport,
  ReadinessAssessmentRecord,
  Roadmap,
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
  actorStaffId: string;
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

export class AfloStore {
  private readonly db: SyntheticDatabase;
  readonly outbox: OutboxRecord[] = [];
  readonly auditLog: AuditEntry[] = [];
  private counter = 0;

  constructor(
    seed: SyntheticDatabase = syntheticDatabase,
    private readonly clock: () => Date = () => new Date(),
  ) {
    this.db = structuredClone(seed);
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

    return { ok: true, transition, report, emittedEventIds: emitted.map((e) => e.eventId) };
  }

  /** Recorded assessment history for one client, oldest first, org-verified. */
  assessmentsFor(organizationId: string, clientId: string): ReadinessAssessmentRecord[] {
    const record = this.findRecord(organizationId, clientId);
    if (!record) return [];
    return this.db.assessments.filter((a) => a.clientId === clientId);
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

  private findRecord(organizationId: string, id: string): ClientRecord | undefined {
    return this.db.clients.find((c) => c.id === id && c.organizationId === organizationId);
  }

  private findActor(organizationId: string, staffId: string) {
    return this.db.staff.find((s) => s.id === staffId && s.organizationId === organizationId);
  }

  private audit(entry: Omit<AuditEntry, "id">): void {
    this.counter += 1;
    this.auditLog.push({ id: `audit-${this.counter}`, ...entry });
  }
}
