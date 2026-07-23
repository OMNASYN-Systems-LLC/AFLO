"use server";

import { revalidatePath } from "next/cache";
import { portalMessaging } from "@/lib/messaging-client";

/**
 * Client-side secure-message reply (messaging.v1.0.0), through the
 * runtime-selected seam (ADR-0046) — never the store or repository directly.
 *
 * SAFETY BOUNDARY: the client-facing projection (`ClientThreadView`) is
 * deliberately id-free — the browser never receives an internal thread id. So
 * the reply targets a thread by its POSITION in the client's own conversation
 * list, which the seam re-resolves server-side from the session. Two
 * properties make this safe:
 *   1. Identity (org + client) comes ONLY from the server-resolved session
 *      inside the seam, never the browser. A tampered index can therefore only
 *      ever index into *this client's own* threads — never another client's or
 *      another org's.
 *   2. The write below the seam re-verifies the thread's org and that the
 *      sender is the thread's own client (demo: the store; persistent: the
 *      ADR-0044 route services). A denial is fail-closed and — by the seam's
 *      vocabulary — indistinguishable from a missing thread, so this layer
 *      adds NO authorization logic and never distinguishes denial.
 * The index order matches the rendered list because both sort conversations by
 * `(lastMessageAt ?? createdAt)` descending.
 */
export async function sendClientMessageAction(
  threadIndex: number,
  formData: FormData,
): Promise<void> {
  await portalMessaging().sendReply(threadIndex, String(formData.get("body") ?? ""));
  revalidatePath("/portal");
}

/**
 * Client marks a thread's advisor messages read (read receipts). Same id-free
 * targeting as replies: the thread is resolved by its position in the client's
 * own conversation list, server-side from the session, so the browser never
 * holds an internal thread id. The write is re-verified below the seam and is
 * idempotent.
 */
export async function markClientThreadReadAction(threadIndex: number): Promise<void> {
  await portalMessaging().markThreadRead(threadIndex);
  revalidatePath("/portal");
}
