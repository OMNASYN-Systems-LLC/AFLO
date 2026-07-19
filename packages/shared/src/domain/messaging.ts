import type { MessageSenderRole, ThreadStatus } from "@aflo/rules";

/**
 * Secure staff↔client messaging domain model + the client-facing projection.
 *
 * SAFETY BOUNDARY: a client thread view is built ONLY from `Message`s. Internal
 * staff notes are a SEPARATE model (`AdminNote`) that is not representable here,
 * so an internal note can never leak into what a client sees. The projection
 * also drops staff identity — a client sees "you" vs "advisor", never a staff
 * member id — and every internal field (org, read receipts, sender ids).
 */

export interface ConversationThread {
  id: string;
  organizationId: string;
  /** The client this thread belongs to — the tenant subject. */
  clientId: string;
  subject: string;
  status: ThreadStatus;
  createdAt: string; // ISO datetime
  /** ISO datetime of the most recent message; null for an empty thread. */
  lastMessageAt: string | null;
}

export interface Message {
  id: string;
  threadId: string;
  organizationId: string;
  clientId: string;
  senderRole: MessageSenderRole;
  /** Staff member id, or the client id when the client sent it. */
  senderId: string;
  body: string;
  sentAt: string; // ISO datetime
  readByClientAt: string | null;
  readByStaffAt: string | null;
}

/** One message as the client sees it — no ids, no internal metadata. */
export interface ClientThreadMessage {
  /** The client's own messages read as "you"; staff messages as "advisor". */
  from: "you" | "advisor";
  body: string;
  sentAt: string;
}

export interface ClientThreadView {
  subject: string;
  status: ThreadStatus;
  messages: ClientThreadMessage[];
}

/**
 * Project a thread + its messages into the client-safe view. Takes `Message[]`
 * ONLY (never `AdminNote`), filters to this thread defensively, orders by time,
 * and strips every internal field — the client sees "you"/"advisor", body, and
 * time, nothing else.
 */
export function toClientThreadView(thread: ConversationThread, messages: Message[]): ClientThreadView {
  const ordered = messages
    .filter((m) => m.threadId === thread.id)
    .slice()
    .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  return {
    subject: thread.subject,
    status: thread.status,
    messages: ordered.map((m) => ({
      from: m.senderRole === "client" ? "you" : "advisor",
      body: m.body,
      sentAt: m.sentAt,
    })),
  };
}
