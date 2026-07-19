"use server";

import { revalidatePath } from "next/cache";
import { getClientSession, store } from "@/lib/data";

/**
 * Client-side secure-message reply (messaging.v1.0.0).
 *
 * SAFETY BOUNDARY: the client-facing projection (`ClientThreadView`) is
 * deliberately id-free — the browser never receives an internal thread id. So
 * the reply targets a thread by its POSITION in the client's own conversation
 * list, which the server re-resolves here from the session. Two properties make
 * this safe:
 *   1. Identity (org + client) comes ONLY from the server session, never the
 *      browser. A tampered index can therefore only ever index into *this
 *      client's own* threads — never another client's or another org's.
 *   2. `store.postReply` re-verifies the thread's org and that the sender is the
 *      thread's own client; a mismatch is denied and audited server-side.
 * The index order matches the portal view because both sort conversations by
 * `(lastMessageAt ?? createdAt)` descending.
 */
export async function sendClientMessageAction(
  threadIndex: number,
  formData: FormData,
): Promise<void> {
  const session = await getClientSession();

  // Re-resolve the client's own threads server-side; index into that list only.
  const threads = store.conversationsFor(session.organizationId, session.clientId);
  const thread = threads[threadIndex];
  if (!thread) return; // stale/invalid index — no-op (never targets a foreign thread)

  store.postReply({
    organizationId: session.organizationId,
    threadId: thread.id,
    senderRole: "client",
    senderId: session.clientId,
    body: String(formData.get("body") ?? ""),
  });

  revalidatePath("/portal");
}
