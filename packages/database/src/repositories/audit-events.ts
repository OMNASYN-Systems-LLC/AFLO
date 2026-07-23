import { asc } from "drizzle-orm";
import { auditEvents } from "../schema";
import { withOrgContext, type TenantScopedDb } from "../request-context";
import {
  MESSAGING_DENIAL_AUDIT_ACTION,
  type SensitiveDenialAuditEvent,
  type SensitiveDenialAuditSink,
} from "../services/authorized-messaging";

/**
 * Append-only audit-event repository (Workstream B9, ADR-0044) over the
 * existing `audit_events` table (migration 0000; RLS `org_isolation` since
 * 0003). Runs on the TENANT connection through `withOrgContext`, so every
 * write and read is scoped to exactly one organization — a tenant can never
 * read (or forge) another tenant's audit trail.
 *
 * PAYLOAD DISCIPLINE (founder decision 4 + matrix §7): rows carry ids,
 * digests, reason codes, and actor/membership ids ONLY — never message
 * content, raw tokens, emails, or any PII beyond what the table already
 * models. `detail` is a compact JSON string of identifiers/codes; callers
 * must never place free text or content in it.
 *
 * The repository exposes exactly two operations: `record` (append) and a
 * TESTS-ONLY `listForOrganization`. There is no update or delete surface —
 * append-only is structural, not merely convention.
 *
 * It also implements the `MessagingDenialAuditSink` port declared by
 * `AuthorizedMessagingService` (the interface lives in the service file; this
 * is its production implementation). One deliberate boundary: a denial with NO
 * organization context (platform-admin probe of a tenant surface, degenerate
 * session) cannot be represented in the org-scoped `audit_events` table
 * (`organization_id` NOT NULL + FORCE RLS). Those events are still EMITTED —
 * the sink receives every one — and are surfaced through the injected
 * `onUnscopedDenial` structured logger (ids/reason codes only) until the
 * separate platform-plane audit surface (ADR-0025) lands. Documented in
 * ADR-0044.
 */

/** One audit event to append. Ids/codes only — see the module payload discipline. */
export interface AuditEventInsert {
  organizationId: string;
  /** The acting member's `organization_members.id`, when the actor has one. */
  actorMemberId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  /** Compact JSON of identifiers/reason codes only — never content or PII. */
  detail: string | null;
  reasonCode: string | null;
  ruleVersion?: string | null;
  occurredAt: Date;
}

export interface StoredAuditEvent {
  id: string;
  organizationId: string;
  actorMemberId: string | null;
  action: string;
  targetType: string;
  targetId: string;
  detail: string | null;
  reasonCode: string | null;
  ruleVersion: string | null;
  occurredAtIso: string;
}

export class DrizzleAuditEventRepository implements SensitiveDenialAuditSink {
  constructor(
    private readonly db: TenantScopedDb,
    /**
     * Structured secondary channel for denials with no organization context
     * (see module doc). Receives a single-line JSON of ids/reason codes only.
     */
    private readonly onUnscopedDenial: (line: string) => void = (line) => {
      console.error(`[audit] unscoped sensitive denial (no tenant row possible): ${line}`);
    },
  ) {}

  /** Append one audit event under its organization (RLS-scoped). */
  async record(event: AuditEventInsert): Promise<void> {
    await withOrgContext(this.db, event.organizationId, async (tx) => {
      await tx.insert(auditEvents).values({
        organizationId: event.organizationId,
        actorMemberId: event.actorMemberId,
        action: event.action,
        targetType: event.targetType,
        targetId: event.targetId,
        detail: event.detail,
        reasonCode: event.reasonCode,
        ruleVersion: event.ruleVersion ?? null,
        occurredAt: event.occurredAt,
      });
    });
  }

  /**
   * `SensitiveDenialAuditSink` — persist a sensitive denial (messaging OR
   * invitation surface) with its DISTINCT internal reason (founder decision
   * 4). The external response stays anti-oracle uniform; only this internal
   * record preserves the category. A pre-resource denial has no target id —
   * the NOT NULL column stores the stable sentinel `"none"`.
   */
  async recordSensitiveDenial(event: SensitiveDenialAuditEvent): Promise<void> {
    if (!event.organizationId) {
      // No tenant exists to scope the row under — platform-plane surface
      // (module doc). Emit ids/codes only; never content, never PII.
      this.onUnscopedDenial(
        JSON.stringify({
          action: MESSAGING_DENIAL_AUDIT_ACTION,
          reason: event.reason,
          engineReason: event.engineReason,
          permission: event.permission,
          afloUserId: event.afloUserId,
          actorRole: event.actorRole,
          targetType: event.target.type,
          targetId: event.target.id ?? "none",
          occurredAt: event.occurredAt.toISOString(),
        }),
      );
      return;
    }
    await this.record({
      organizationId: event.organizationId,
      actorMemberId: event.actorMembershipId,
      action: MESSAGING_DENIAL_AUDIT_ACTION,
      targetType: event.target.type,
      targetId: event.target.id ?? "none",
      detail: JSON.stringify({
        engineReason: event.engineReason,
        permission: event.permission,
        afloUserId: event.afloUserId,
        actorRole: event.actorRole,
        actorClientId: event.actorClientId,
      }),
      reasonCode: event.reason,
      occurredAt: event.occurredAt,
    });
  }

  /** TESTS ONLY: the organization's audit rows, oldest first (RLS-scoped read). */
  async listForOrganization(organizationId: string): Promise<StoredAuditEvent[]> {
    const rows = await withOrgContext(this.db, organizationId, async (tx) =>
      tx.select().from(auditEvents).orderBy(asc(auditEvents.occurredAt), asc(auditEvents.id)),
    );
    return rows.map((row) => ({
      id: row.id,
      organizationId: row.organizationId,
      actorMemberId: row.actorMemberId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      detail: row.detail,
      reasonCode: row.reasonCode,
      ruleVersion: row.ruleVersion,
      occurredAtIso: row.occurredAt.toISOString(),
    }));
  }
}
