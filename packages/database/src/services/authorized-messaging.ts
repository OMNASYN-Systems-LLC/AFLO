import {
  authorize,
  toPrincipal,
  type DenialReason,
  type Permission,
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
 * Authorization-gated messaging service (Workstream B8 / task #61).
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
 * code. Route handlers for READ paths should render a denial indistinguishably
 * from not-found (both 404) so probing same-org thread ids yields no oracle;
 * an unknown/foreign-org thread already reads as null from the repository.
 *
 * Platform Admin: holds `message.read` in the matrix but has NO tenant binding
 * (`activeOrganizationId` null) — cross-tenant access is a separate audited
 * surface (ADR-0025), so THIS service fails closed on a missing org for every
 * role.
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

/** The messaging sender identity derived from a session (never caller-supplied). */
interface DerivedSender {
  role: MessageSenderRole;
  id: string;
}

export class AuthorizedMessagingService {
  private readonly repo: MessagingRepository;

  constructor(repo: MessagingRepository) {
    this.repo = repo;
  }

  /** The caller's tenant, fail-closed: no active org → no messaging access. */
  private requireOrg(ctx: SessionContext, permission: Permission): string {
    const org = ctx.activeOrganizationId;
    if (!org || org.trim().length === 0) {
      throw new MessagingAccessDeniedError("no_active_membership", permission);
    }
    return org;
  }

  /** Authorize `permission` against a client-owned messaging resource. */
  private check(ctx: SessionContext, permission: Permission, organizationId: string, clientId: string): void {
    const decision = authorize({
      principal: toPrincipal(ctx),
      permission,
      resource: { organizationId, clientId },
    });
    if (!decision.allowed) throw new MessagingAccessDeniedError(decision.reason, permission);
  }

  /**
   * Who is speaking/reading, derived from the verified session. A client IS
   * their linked client record; any staff-side role speaks as its membership.
   * Fails closed on a degenerate context (missing link/membership).
   */
  private deriveSender(ctx: SessionContext, permission: Permission): DerivedSender {
    if (ctx.role === "client") {
      if (!ctx.linkedClientId) throw new MessagingAccessDeniedError("unauthenticated", permission);
      return { role: "client", id: ctx.linkedClientId };
    }
    if (!ctx.activeMembershipId) throw new MessagingAccessDeniedError("no_active_membership", permission);
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
    this.check(ctx, permission, organizationId, thread.clientId);
    return thread;
  }

  /** Open a thread with a client (staff), or with yourself (client self-service). */
  async createThread(ctx: SessionContext, input: CreateThreadInput, now: Date): Promise<ConversationThread> {
    const org = this.requireOrg(ctx, "message.send");
    this.check(ctx, "message.send", org, input.clientId);
    return this.repo.createThread(org, input, now);
  }

  /** A thread, or null for unknown ids; denied same-org access throws. */
  async getThread(ctx: SessionContext, threadId: string): Promise<ConversationThread | null> {
    const org = this.requireOrg(ctx, "message.read");
    return this.loadThread(ctx, org, threadId, "message.read");
  }

  /** A client's threads (ownership/assignment gates apply to the client id). */
  async listThreads(ctx: SessionContext, clientId: string): Promise<ConversationThread[]> {
    const org = this.requireOrg(ctx, "message.read");
    this.check(ctx, "message.read", org, clientId);
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
    const org = this.requireOrg(ctx, "message.send");
    const thread = await this.loadThread(ctx, org, input.threadId, "message.send");
    if (!thread) throw new ThreadNotFoundError(input.threadId);
    const sender = this.deriveSender(ctx, "message.send");
    return this.repo.postMessage(
      org,
      { threadId: thread.id, senderRole: sender.role, senderId: sender.id, body: input.body },
      now,
    );
  }

  /** A thread's messages, oldest first (decrypted below this boundary). */
  async listMessages(ctx: SessionContext, threadId: string): Promise<Message[]> {
    const org = this.requireOrg(ctx, "message.read");
    const thread = await this.loadThread(ctx, org, threadId, "message.read");
    if (!thread) return [];
    return this.repo.listMessages(org, thread.id);
  }

  /** Mark the counterparty's messages read AS the session's derived role. */
  async markThreadRead(ctx: SessionContext, threadId: string, now: Date): Promise<number> {
    const org = this.requireOrg(ctx, "message.read");
    const thread = await this.loadThread(ctx, org, threadId, "message.read");
    if (!thread) return 0;
    const reader = this.deriveSender(ctx, "message.read");
    return this.repo.markThreadRead(org, thread.id, reader.role, now);
  }

  /** Close/reopen a thread — `message.close` (staff-side roles only, per policy). */
  async setThreadStatus(
    ctx: SessionContext,
    threadId: string,
    action: "close" | "reopen",
    now: Date,
  ): Promise<ThreadStatus> {
    const org = this.requireOrg(ctx, "message.close");
    const thread = await this.loadThread(ctx, org, threadId, "message.close");
    if (!thread) throw new ThreadNotFoundError(threadId);
    return this.repo.setThreadStatus(org, thread.id, action, now);
  }
}
