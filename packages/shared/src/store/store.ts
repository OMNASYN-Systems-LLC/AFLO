import {
  INTAKE_RULES_VERSION,
  PIPELINE_BACKBONE,
  READINESS_RULES_VERSION,
  REASON_CODE_NEXT_ACTIONS,
  assessReadiness,
  assessmentReviewGate,
  intakeCompleteness,
  nextRequiredStage,
  pipelineTransition,
  sectionCompletion,
  type IntakeCompletenessResult,
  type PipelineTransitionResult,
  type ReviewGateResult,
} from "@aflo/rules";
import { createEvent, type DomainEvent } from "../events";
import { toOutboxRecord, type OutboxRecord } from "../outbox";
import { syntheticDatabase, type SyntheticDatabase } from "../data/synthetic";
import { toReadinessFacts } from "../domain/facts";
import type { ClientRecord, IntakeRecord, ReadinessAssessmentRecord } from "../domain/types";

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
