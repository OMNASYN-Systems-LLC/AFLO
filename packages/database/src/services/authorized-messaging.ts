import {
  authorize,
  toPrincipal,
  type DenialReason,
  type Permission,
  type Role,
  type SessionContext,
} from "@aflo/auth";
import type { MessageSenderRole, ThreadStatus } from "@aflo/rules";
import type {
  ConversationThread,
  CreateThreadInput,
  Message,
  MessagingRepository,
} from "@aflo/shared";
import { ThreadNotFoundError } from "../repositories/messaging";

/**
 * Authorization-gated messaging service (Workstream B8 / task #61; denial
 * audit: Workstream B9, ADR-0044).
 *
 * The `MessagingRepository` deliberately owns TENANT isolation (RLS via
 * `withOrgContext`) and WELL-FORMEDNESS (kernel re-checks), but not WHO-MAY —
 * cross-principal authorization is the engine's job (ADR-0018). This service is
 * that gate: every method resolves the caller's `SessionContext` to a
 * `Principal`, runs `authorize()` with the messaging permission and the
 * resource's client ownership, and only then delegates.
 *
 * Structural properties (unrepresentable, not merely checked):
 *   - **No caller-supplied org.** The tenant is `ctx.activeOrganizationId`
 *     (server-resolved) — the method signatures have no organizationId
 *     parameter, so a confused-deputy cross-org call cannot be expressed.
 *   - **No caller-supplied sender.** `postMessage`/`markThreadRead` derive the
 *     sender/reader identity FROM the session (client → the linked client id,
 *     staff → the active membership id) — the input has no sender fields, so a
 *     client cannot post as staff or as another client.
 *   - **Authorize-then-act on the loaded thread.** Thread-scoped methods load
 *     the thread first (an RLS-scoped read under the caller's own org) and
 *     authorize against the thread's ACTUAL clientId — never a caller claim.
 *
 * Denials throw `MessagingAccessDeniedError` with the engine's stable reason
 * code. ROUTE MAPPING RULE (uniform, ALL seven methods — writes included): a
 * `MessagingAccessDeniedError` and a not-found/unknown id MUST render
 * identically (404-shaped), never 403-vs-404 or 200-empty-vs-404 — otherwise
 * same-org id probing gains an existence oracle. An unknown/foreign-org thread
 * already reads as null/empty from the repository.
 *
 * SENSITIVE-DENIAL AUDIT (founder decision 4, MANDATORY — ADR-0044): every
 * denial path emits ONE audit event through the REQUIRED injected
 * `MessagingDenialAuditSink` BEFORE throwing. The event carries the DISTINCT
 * internal reason (the founder's sensitive-denial category), while the thrown
 * error — and therefore the external route response — stays byte-identical to
 * not-found (anti-oracle). Emission can never suppress the denial: an audit
 * write failure is routed to `onAuditFailure` (a logged secondary error) and
 * the denial still throws. The event carries ids and reason codes only —
 * never message content, tokens, or PII.
 *
 * Platform Admin: holds `message.read` in the matrix but has NO tenant binding
 * (`activeOrganizationId` null) — cross-tenant access is a separate audited
 * surface (ADR-0025), so THIS service fails closed on a missing org for every
 * role (audited as `platform_admin_cross_tenant_access`).
 */

export class MessagingAccessDeniedError extends Error {
  constructor(
    public readonly reason: DenialReason,
    public readonly permission: Permission,
  ) {
    super(`messaging access denied: ${permission} (${reason})`);
    this.name = "MessagingAccessDeniedError";
  }
}

/** The audit `action` recorded for every sensitive messaging denial. */
export const MESSAGING_DENIAL_AUDIT_ACTION = "messaging.access_denied";

/**
 * The founder's sensitive-denial categories (founder decision 4, verbatim
 * list): cross-tenant access; wrong-client access; ownership mismatch;
 * staff-assignment mismatch; revoked membership; disabled account; revoked
 * client link; ambiguous identity; invalid organization context;
 * platform-admin cross-tenant access; attempted publication without authority.
 *
 * These are INTERNAL audit reason codes only — they never appear in an
 * external response (anti-oracle uniformity). `revoked_client_link` is
 * reserved: a revoked link never resolves a session (the principal directory
 * returns active links only, so those callers 401 upstream) — no messaging
 * branch can currently observe it, but the vocabulary keeps the founder's
 * category stable for the session-resolution audit surface.
 */
export type SensitiveDenialReason =
  | "cross_tenant_access"
  | "wrong_client_access"
  | "ownership_mismatch"
  | "staff_assignment_mismatch"
  | "revoked_membership"
  | "disabled_account"
  | "revoked_client_link"
  | "ambiguous_identity"
  | "invalid_organization_context"
  | "platform_admin_cross_tenant_access"
  | "publication_without_authority";

/** What a sensitive denial targeted — an id + coarse type, never content. */
export interface MessagingDenialTarget {
  type: "conversation_thread" | "client";
  id: string;
}

/**
 * One sensitive-denial audit event. Ids, roles, and reason codes ONLY — never
 * message content, tokens, or PII. `organizationId` is null exactly when the
 * denial IS the missing org context (no tenant existed to scope under).
 */
export interface MessagingDenialAuditEvent {
  organizationId: string | null;
  afloUserId: string;
  actorRole: Role;
  actorMembershipId: string | null;
  actorClientId: string | null;
  /** The DISTINCT internal category (founder decision 4). */
  reason: SensitiveDenialReason;
  /** The engine's stable code — what the thrown error carries. */
  engineReason: DenialReason;
  permission: Permission;
  target: MessagingDenialTarget;
  occurredAt: Date;
}

/**
 * REQUIRED audit port (production: `DrizzleAuditEventRepository`). A rejected
 * promise must not — and does not — suppress the denial (see `deny`).
 */
export interface MessagingDenialAuditSink {
  recordSensitiveDenial(event: MessagingDenialAuditEvent): Promise<void>;
}

/**
 * Map an engine denial to the closest founder category (ADR-0044 §mapping).
 * `not_owner` splits by target: a thread target is an attempt on another
 * client's CONVERSATION (`wrong_client_access`); a client target is an attempt
 * to act AS/FOR another client (`ownership_mismatch`). `permission_denied` on
 * the messaging surface is an attempt to publish into a client channel without
 * the authority to do so. `consent_required`/`invalid_record_state` are
 * structurally unreachable here (the service never sets those resource gates)
 * but map fail-safe rather than throwing on an unknown code.
 */
function toSensitiveReason(
  engineReason: DenialReason,
  actorRole: Role,
  target: MessagingDenialTarget,
): SensitiveDenialReason {
  switch (engineReason) {
    case "cross_tenant":
      return "cross_tenant_access";
    case "not_owner":
      return target.type === "conversation_thread" ? "wrong_client_access" : "ownership_mismatch";
    case "not_assigned":
      return "staff_assignment_mismatch";
    case "membership_revoked":
      return "revoked_membership";
    case "account_disabled":
      return "disabled_account";
    case "membership_pending":
      return "invalid_organization_context";
    case "no_active_membership":
      return actorRole === "platform_admin"
        ? "platform_admin_cross_tenant_access"
        : "invalid_organization_context";
    case "unauthenticated":
      return "ambiguous_identity";
    case "permission_denied":
    case "consent_required":
      return "publication_without_authority";
    default:
      // "invalid_record_state" (+ any future engine code): fail-safe category.
      return "invalid_organization_context";
  }
}

/** The messaging sender identity derived from a session (never caller-supplied). */
interface DerivedSender {
  role: MessageSenderRole;
  id: string;
}

export class AuthorizedMessagingService {
  private readonly repo: MessagingRepository;
  private readonly auditSink: MessagingDenialAuditSink;
  private readonly onAuditFailure: (error: unknown) => void;

  constructor(
    repo: MessagingRepository,
    /** REQUIRED (founder decision 4): every sensitive denial is audited. */
    auditSink: MessagingDenialAuditSink,
    /** Secondary-error channel for a failed audit write (the denial still wins). */
    onAuditFailure: (error: unknown) => void = (error) => {
      console.error("[messaging] sensitive-denial audit write failed (denial still enforced)", error);
    },
  ) {
    this.repo = repo;
    this.auditSink = auditSink;
    this.onAuditFailure = onAuditFailure;
  }

  /**
   * Emit the audit event, then throw. ALWAYS throws. The emit is awaited so a
   * durable record precedes the response, but a failed write cannot suppress
   * the denial — it is caught and surfaced via `onAuditFailure` only.
   */
  private async deny(
    ctx: SessionContext,
    organizationId: string | null,
    permission: Permission,
    engineReason: DenialReason,
    target: MessagingDenialTarget,
    reasonOverride?: SensitiveDenialReason,
  ): Promise<never> {
    const event: MessagingDenialAuditEvent = {
      organizationId,
      afloUserId: ctx.afloUserId,
      actorRole: ctx.role,
      actorMembershipId: ctx.activeMembershipId,
      actorClientId: ctx.linkedClientId,
      reason: reasonOverride ?? toSensitiveReason(engineReason, ctx.role, target),
      engineReason,
      permission,
      target,
      occurredAt: new Date(),
    };
    try {
      await this.auditSink.recordSensitiveDenial(event);
    } catch (error) {
      this.onAuditFailure(error);
    }
    throw new MessagingAccessDeniedError(engineReason, permission);
  }

  /** The caller's tenant, fail-closed: no active org → no messaging access. */
  private async requireOrg(
    ctx: SessionContext,
    permission: Permission,
    target: MessagingDenialTarget,
  ): Promise<string> {
    const org = ctx.activeOrganizationId;
    if (!org || org.trim().length === 0) {
      return this.deny(ctx, null, permission, "no_active_membership", target);
    }
    return org;
  }

  /** Authorize `permission` against a client-owned messaging resource. */
  private async check(
    ctx: SessionContext,
    permission: Permission,
    organizationId: string,
    clientId: string,
    target: MessagingDenialTarget,
  ): Promise<void> {
    const decision = authorize({
      principal: toPrincipal(ctx),
      permission,
      resource: { organizationId, clientId },
    });
    if (!decision.allowed) {
      await this.deny(ctx, organizationId, permission, decision.reason, target);
    }
  }

  /**
   * Who is speaking/reading, derived from the verified session. A client IS
   * their linked client record; any staff-side role speaks as its membership.
   * Fails closed on a degenerate context (missing link/membership) — audited
   * as `ambiguous_identity` (the session cannot name who is speaking).
   */
  private async deriveSender(
    ctx: SessionContext,
    organizationId: string,
    permission: Permission,
    target: MessagingDenialTarget,
  ): Promise<DerivedSender> {
    if (ctx.role === "client") {
      if (!ctx.linkedClientId) {
        return this.deny(ctx, organizationId, permission, "unauthenticated", target, "ambiguous_identity");
      }
      return { role: "client", id: ctx.linkedClientId };
    }
    if (!ctx.activeMembershipId) {
      return this.deny(ctx, organizationId, permission, "no_active_membership", target, "ambiguous_identity");
    }
    return { role: "staff", id: ctx.activeMembershipId };
  }

  /** Load a thread under the caller's org (RLS-scoped); null = unknown/foreign. */
  private async loadThread(
    ctx: SessionContext,
    organizationId: string,
    threadId: string,
    permission: Permission,
  ): Promise<ConversationThread | null> {
    const thread = await this.repo.getThread(organizationId, threadId);
    if (!thread) return null;
    await this.check(ctx, permission, organizationId, thread.clientId, {
      type: "conversation_thread",
      id: threadId,
    });
    return thread;
  }

  /** Open a thread with a client (staff), or with yourself (client self-service). */
  async createThread(ctx: SessionContext, input: CreateThreadInput, now: Date): Promise<ConversationThread> {
    const target: MessagingDenialTarget = { type: "client", id: input.clientId };
    const org = await this.requireOrg(ctx, "message.send", target);
    await this.check(ctx, "message.send", org, input.clientId, target);
    return this.repo.createThread(org, input, now);
  }

  /** A thread, or null for unknown ids; denied same-org access throws. */
  async getThread(ctx: SessionContext, threadId: string): Promise<ConversationThread | null> {
    const org = await this.requireOrg(ctx, "message.read", { type: "conversation_thread", id: threadId });
    return this.loadThread(ctx, org, threadId, "message.read");
  }

  /** A client's threads (ownership/assignment gates apply to the client id). */
  async listThreads(ctx: SessionContext, clientId: string): Promise<ConversationThread[]> {
    const target: MessagingDenialTarget = { type: "client", id: clientId };
    const org = await this.requireOrg(ctx, "message.read", target);
    await this.check(ctx, "message.read", org, clientId, target);
    return this.repo.listThreads(org, clientId);
  }

  /**
   * Post to a thread as the SESSION's derived sender. The caller supplies only
   * the thread and the plaintext body — never a sender or an org.
   */
  async postMessage(
    ctx: SessionContext,
    input: { threadId: string; body: string },
    now: Date,
  ): Promise<Message> {
    const target: MessagingDenialTarget = { type: "conversation_thread", id: input.threadId };
    const org = await this.requireOrg(ctx, "message.send", target);
    const thread = await this.loadThread(ctx, org, input.threadId, "message.send");
    if (!thread) throw new ThreadNotFoundError(input.threadId);
    const sender = await this.deriveSender(ctx, org, "message.send", target);
    return this.repo.postMessage(
      org,
      { threadId: thread.id, senderRole: sender.role, senderId: sender.id, body: input.body },
      now,
    );
  }

  /** A thread's messages, oldest first (decrypted below this boundary). */
  async listMessages(ctx: SessionContext, threadId: string): Promise<Message[]> {
    const org = await this.requireOrg(ctx, "message.read", { type: "conversation_thread", id: threadId });
    const thread = await this.loadThread(ctx, org, threadId, "message.read");
    if (!thread) return [];
    return this.repo.listMessages(org, thread.id);
  }

  /** Mark the counterparty's messages read AS the session's derived role. */
  async markThreadRead(ctx: SessionContext, threadId: string, now: Date): Promise<number> {
    const target: MessagingDenialTarget = { type: "conversation_thread", id: threadId };
    const org = await this.requireOrg(ctx, "message.read", target);
    const thread = await this.loadThread(ctx, org, threadId, "message.read");
    if (!thread) return 0;
    const reader = await this.deriveSender(ctx, org, "message.read", target);
    return this.repo.markThreadRead(org, thread.id, reader.role, now);
  }

  /** Close/reopen a thread — `message.close` (staff-side roles only, per policy). */
  async setThreadStatus(
    ctx: SessionContext,
    threadId: string,
    action: "close" | "reopen",
    now: Date,
  ): Promise<ThreadStatus> {
    const org = await this.requireOrg(ctx, "message.close", { type: "conversation_thread", id: threadId });
    const thread = await this.loadThread(ctx, org, threadId, "message.close");
    if (!thread) throw new ThreadNotFoundError(threadId);
    return this.repo.setThreadStatus(org, thread.id, action, now);
  }
}
