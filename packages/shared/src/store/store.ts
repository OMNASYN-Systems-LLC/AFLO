import {
  nextRequiredStage,
  pipelineTransition,
  type PipelineTransitionResult,
} from "@aflo/rules";
import { createEvent, type DomainEvent } from "../events";
import { toOutboxRecord, type OutboxRecord } from "../outbox";
import { syntheticDatabase, type SyntheticDatabase } from "../data/synthetic";
import type { ClientRecord } from "../domain/types";

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
 */

export interface AuditEntry {
  id: string;
  organizationId: string;
  actorStaffId: string;
  action: string; // e.g. "lead.stage_advanced", "lead.stage_denied"
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
  | "NOT_A_LEAD";

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
    const record = this.db.clients.find(
      (c) => c.id === input.leadId && c.organizationId === input.organizationId,
    );
    if (!record) return { ok: false, denialCode: "LEAD_NOT_FOUND", activated: false, emittedEventIds: [] };

    const actor = this.db.staff.find(
      (s) => s.id === input.actorStaffId && s.organizationId === input.organizationId,
    );
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

  /** The forward stage a lead should reach next (UI "next action"). */
  nextStageFor(organizationId: string, leadId: string) {
    const record = this.db.clients.find(
      (c) => c.id === leadId && c.organizationId === organizationId,
    );
    if (!record) return null;
    return nextRequiredStage(this.db.pipeline, record.pipelineStageId);
  }

  private audit(entry: Omit<AuditEntry, "id">): void {
    this.counter += 1;
    this.auditLog.push({ id: `audit-${this.counter}`, ...entry });
  }
}
