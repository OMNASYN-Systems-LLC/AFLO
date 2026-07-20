/**
 * Deterministic secure-messaging kernel (messaging.v1.0.0).
 *
 * Pure validation for staff↔client conversation threads — the store applies
 * the result and never posts an invalid message or writes an illegal thread
 * transition. This kernel governs message WELL-FORMEDNESS and thread state; it
 * does NOT decide visibility. Client-facing visibility is a structural property
 * of the domain projection (`toClientThreadView`): a client thread is built
 * only from Messages, so internal staff notes (a separate `AdminNote` model)
 * can never appear in it.
 *
 * No AI: message bodies are authored by humans; this only validates them.
 */

export const MESSAGING_RULES_VERSION = "messaging.v1.0.0";

/** Upper bound on a single message body (post-trim), in characters. */
export const MAX_MESSAGE_BODY_CHARS = 5000;

/** The two sides of a secure thread. Kernel-owned so the DB enum can't drift. */
export const MESSAGE_SENDER_ROLES = ["staff", "client"] as const;
export type MessageSenderRole = (typeof MESSAGE_SENDER_ROLES)[number];

/** Thread lifecycle states. Kernel-owned so the DB enum can't drift. */
export const THREAD_STATUSES = ["open", "closed"] as const;
export type ThreadStatus = (typeof THREAD_STATUSES)[number];

export type MessageReasonCode =
  | "MSG_OK"
  | "MSG_EMPTY_BODY"
  | "MSG_BODY_TOO_LONG"
  | "MSG_MISSING_SENDER"
  | "MSG_THREAD_CLOSED";

export interface MessageDraft {
  senderId: string;
  senderRole: MessageSenderRole;
  body: string;
}

export interface MessageValidation {
  ok: boolean;
  reasonCode: MessageReasonCode;
  ruleVersion: string;
  /** Trimmed body when ok; null on any rejection. */
  normalizedBody: string | null;
}

function deny(reasonCode: MessageReasonCode): MessageValidation {
  return { ok: false, reasonCode, ruleVersion: MESSAGING_RULES_VERSION, normalizedBody: null };
}

/**
 * Validate a message draft against its thread's status. Rejects (fail-closed):
 * a missing sender, a closed thread, an empty/whitespace body, or a body over
 * the length cap. On success returns the trimmed body the store should persist.
 */
export function validateMessageDraft(draft: MessageDraft, threadStatus: ThreadStatus): MessageValidation {
  if (!draft.senderId.trim()) return deny("MSG_MISSING_SENDER");
  if (threadStatus === "closed") return deny("MSG_THREAD_CLOSED");
  const body = draft.body.trim();
  if (body.length === 0) return deny("MSG_EMPTY_BODY");
  if (body.length > MAX_MESSAGE_BODY_CHARS) return deny("MSG_BODY_TOO_LONG");
  return { ok: true, reasonCode: "MSG_OK", ruleVersion: MESSAGING_RULES_VERSION, normalizedBody: body };
}

export type ThreadActionReasonCode = "MSG_OK" | "MSG_ILLEGAL_THREAD_TRANSITION";
export type ThreadAction = "close" | "reopen";

export interface ThreadTransition {
  ok: boolean;
  reasonCode: ThreadActionReasonCode;
  ruleVersion: string;
  /** The resulting status when ok; the unchanged current status on rejection. */
  status: ThreadStatus;
}

/** open --close--> closed, closed --reopen--> open. Any other move is rejected. */
export function transitionThread(current: ThreadStatus, action: ThreadAction): ThreadTransition {
  const legal = (action === "close" && current === "open") || (action === "reopen" && current === "closed");
  if (!legal) {
    return { ok: false, reasonCode: "MSG_ILLEGAL_THREAD_TRANSITION", ruleVersion: MESSAGING_RULES_VERSION, status: current };
  }
  return {
    ok: true,
    reasonCode: "MSG_OK",
    ruleVersion: MESSAGING_RULES_VERSION,
    status: action === "close" ? "closed" : "open",
  };
}
