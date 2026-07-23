import { and, asc, eq, isNull, sql } from "drizzle-orm";
import {
  validateMessageDraft,
  transitionThread,
  type ConversationThread,
  type CreateThreadInput,
  type Message,
  type MessageSenderRole,
  type MessagingRepository,
  type PostMessageInput,
  type ThreadStatus,
} from "@aflo/shared";
import type { FieldCipher } from "@aflo/security";
import { conversationThreads, messages, clients } from "../schema";
import { withOrgContext, type TenantScopedDb } from "../request-context";

/**
 * PostgreSQL secure-messaging repository (Drizzle), behind the @aflo/shared
 * MessagingRepository contract. Every operation runs inside `withOrgContext`
 * (ADR-0025), so RLS (migration 0006) scopes it to exactly one organization on a
 * transaction-local GUC — a pooled connection can never carry one request's org
 * into the next.
 *
 * ENCRYPTION BOUNDARY: message bodies are encrypted with the injected
 * `FieldCipher` on write and decrypted on read (ADR-0027/0028). Callers work in
 * plaintext `Message.body`; the DB, its backups, and its query surface hold only
 * ciphertext (`body_encrypted` bytea). No body is ever placed in an event/outbox
 * payload — the `MessagePosted`/`MessageRead` payloads carry ids + roles only.
 *
 * INTEGRITY: a message's `organization_id` and `client_id` are DERIVED from the
 * loaded thread (never caller-supplied), so a message can't be mis-filed to
 * another client — closing the "no cross-table org/client CHECK" gap ADR-0027
 * flagged (FK validation bypasses RLS, so the guard is done here). Cross-CLIENT
 * authorization within an org (a client may only touch their own threads) is the
 * authorization engine's job (ADR-0018 CLIENT_SCOPED_PERMISSIONS); this layer
 * enforces org isolation and message well-formedness.
 *
 * The handle is driver-agnostic (PGlite in tests, node-postgres/Neon in prod),
 * so the credential-free proven path is the production path.
 */

/** Thrown when a thread id is unknown or belongs to another org (RLS-invisible). */
export class ThreadNotFoundError extends Error {
  constructor(public readonly threadId: string) {
    super(`conversation thread not found: ${threadId}`);
    this.name = "ThreadNotFoundError";
  }
}

/** Thrown when a client-referenced row is not in the current org. */
export class MessagingClientNotFoundError extends Error {
  constructor(public readonly clientId: string) {
    super(`client not found in organization: ${clientId}`);
    this.name = "MessagingClientNotFoundError";
  }
}

/** Thrown when a client tries to post to a thread that is not their own. */
export class NotThreadClientError extends Error {
  constructor() {
    super("a client may only post to their own thread");
    this.name = "NotThreadClientError";
  }
}

/** Thrown when the messaging kernel rejects a draft (closed thread / empty / too long). */
export class MessageRejectedError extends Error {
  constructor(public readonly reasonCode: string) {
    super(`message rejected: ${reasonCode}`);
    this.name = "MessageRejectedError";
  }
}

/** Thrown on an illegal thread transition (close a closed thread, etc.). */
export class ThreadTransitionError extends Error {
  constructor(public readonly reasonCode: string) {
    super(`illegal thread transition: ${reasonCode}`);
    this.name = "ThreadTransitionError";
  }
}

type ThreadRow = typeof conversationThreads.$inferSelect;
type MessageRow = typeof messages.$inferSelect;

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toThread(row: ThreadRow): ConversationThread {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    subject: row.subject,
    status: row.status as ThreadStatus,
    createdAt: row.createdAt.toISOString(),
    lastMessageAt: isoOrNull(row.lastMessageAt),
  };
}

export class DrizzleMessagingRepository implements MessagingRepository {
  constructor(
    private readonly db: TenantScopedDb,
    private readonly cipher: FieldCipher,
  ) {}

  /** Decrypt one persisted row to the plaintext domain message. */
  private toMessage(row: MessageRow): Message {
    return {
      id: row.id,
      threadId: row.threadId,
      organizationId: row.organizationId,
      clientId: row.clientId,
      senderRole: row.senderRole as MessageSenderRole,
      senderId: row.senderId,
      // Normalize the driver's bytea (Buffer on node-postgres, Uint8Array on
      // PGlite) to a Buffer before decrypting.
      body: this.cipher.decrypt(Buffer.from(row.bodyEncrypted)),
      sentAt: row.sentAt.toISOString(),
      readByClientAt: isoOrNull(row.readByClientAt),
      readByStaffAt: isoOrNull(row.readByStaffAt),
    };
  }

  async createThread(
    organizationId: string,
    input: CreateThreadInput,
    now: Date,
  ): Promise<ConversationThread> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      // The client must belong to THIS org. RLS scopes the lookup, so a foreign
      // client id returns nothing (the thread FK bypasses RLS, so we check here).
      const owner = await tx
        .select({ id: clients.id })
        .from(clients)
        .where(eq(clients.id, input.clientId))
        .limit(1);
      if (!owner[0]) throw new MessagingClientNotFoundError(input.clientId);

      const inserted = await tx
        .insert(conversationThreads)
        .values({
          organizationId,
          clientId: input.clientId,
          subject: input.subject,
          status: "open",
          createdAt: now,
          updatedAt: now,
        })
        .returning();
      return toThread(inserted[0]!);
    });
  }

  async getThread(organizationId: string, threadId: string): Promise<ConversationThread | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(conversationThreads)
        .where(eq(conversationThreads.id, threadId))
        .limit(1);
      return rows[0] ? toThread(rows[0]) : null;
    });
  }

  async listThreads(organizationId: string, clientId: string): Promise<ConversationThread[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(conversationThreads)
        .where(eq(conversationThreads.clientId, clientId))
        // Active threads first; empty (never-messaged) threads last.
        .orderBy(sql`${conversationThreads.lastMessageAt} desc nulls last`, sql`${conversationThreads.createdAt} desc`, sql`${conversationThreads.id} desc`);
      return rows.map(toThread);
    });
  }

  async postMessage(organizationId: string, input: PostMessageInput, now: Date): Promise<Message> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const threadRows = await tx
        .select()
        .from(conversationThreads)
        .where(eq(conversationThreads.id, input.threadId))
        .limit(1);
      const thread = threadRows[0];
      if (!thread) throw new ThreadNotFoundError(input.threadId);

      // A client may only post to their OWN thread; staff post as a member.
      if (input.senderRole === "client" && input.senderId !== thread.clientId) {
        throw new NotThreadClientError();
      }

      // Deterministic well-formedness (defense-in-depth even if a caller skipped it).
      const validation = validateMessageDraft(
        { senderId: input.senderId, senderRole: input.senderRole, body: input.body },
        thread.status as ThreadStatus,
      );
      if (!validation.ok || validation.normalizedBody === null) {
        throw new MessageRejectedError(validation.reasonCode);
      }

      const iso = now.toISOString();
      const inserted = await tx
        .insert(messages)
        .values({
          organizationId,
          threadId: thread.id,
          // DERIVED from the thread — never caller-supplied.
          clientId: thread.clientId,
          senderRole: input.senderRole,
          senderId: input.senderId,
          bodyEncrypted: this.cipher.encrypt(validation.normalizedBody),
          sentAt: now,
          // A sender's own message is already read by them.
          readByClientAt: input.senderRole === "client" ? now : null,
          readByStaffAt: input.senderRole === "staff" ? now : null,
          createdAt: now,
          updatedAt: now,
        })
        .returning();

      await tx
        .update(conversationThreads)
        .set({ lastMessageAt: now, updatedAt: now })
        .where(eq(conversationThreads.id, thread.id));

      // Return without a round-trip decrypt: the plaintext is the validated body.
      const row = inserted[0]!;
      return {
        id: row.id,
        threadId: row.threadId,
        organizationId: row.organizationId,
        clientId: row.clientId,
        senderRole: row.senderRole as MessageSenderRole,
        senderId: row.senderId,
        body: validation.normalizedBody,
        sentAt: iso,
        readByClientAt: isoOrNull(row.readByClientAt),
        readByStaffAt: isoOrNull(row.readByStaffAt),
      };
    });
  }

  async listMessages(organizationId: string, threadId: string): Promise<Message[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(messages)
        .where(eq(messages.threadId, threadId))
        .orderBy(asc(messages.sentAt));
      return rows.map((row) => this.toMessage(row));
    });
  }

  async markThreadRead(
    organizationId: string,
    threadId: string,
    readerRole: MessageSenderRole,
    now: Date,
  ): Promise<number> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const threadRows = await tx
        .select({ id: conversationThreads.id })
        .from(conversationThreads)
        .where(eq(conversationThreads.id, threadId))
        .limit(1);
      if (!threadRows[0]) throw new ThreadNotFoundError(threadId);

      // Reading marks the OTHER side's messages read; a reader never marks their own.
      // `.returning()` and count the rows — driver-agnostic (the raw update result's
      // row-count field differs between node-postgres and PGlite).
      const counterpart: MessageSenderRole = readerRole === "staff" ? "client" : "staff";
      const updated =
        readerRole === "staff"
          ? await tx
              .update(messages)
              .set({ readByStaffAt: now, updatedAt: now })
              .where(
                and(
                  eq(messages.threadId, threadId),
                  eq(messages.senderRole, counterpart),
                  isNull(messages.readByStaffAt),
                ),
              )
              .returning({ id: messages.id })
          : await tx
              .update(messages)
              .set({ readByClientAt: now, updatedAt: now })
              .where(
                and(
                  eq(messages.threadId, threadId),
                  eq(messages.senderRole, counterpart),
                  isNull(messages.readByClientAt),
                ),
              )
              .returning({ id: messages.id });
      return updated.length;
    });
  }

  async setThreadStatus(
    organizationId: string,
    threadId: string,
    action: "close" | "reopen",
    now: Date,
  ): Promise<ThreadStatus> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select({ status: conversationThreads.status })
        .from(conversationThreads)
        .where(eq(conversationThreads.id, threadId))
        .limit(1);
      const current = rows[0];
      if (!current) throw new ThreadNotFoundError(threadId);

      const transition = transitionThread(current.status as ThreadStatus, action);
      if (!transition.ok) throw new ThreadTransitionError(transition.reasonCode);

      await tx
        .update(conversationThreads)
        .set({ status: transition.status, updatedAt: now })
        .where(eq(conversationThreads.id, threadId));
      return transition.status;
    });
  }
}
