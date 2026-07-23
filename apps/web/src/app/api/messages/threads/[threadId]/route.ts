import { handleGetThread } from "@aflo/database";
import {
  composeMessagingDeps,
  messagingResponse,
  notConfiguredResponse,
} from "@/lib/messaging-runtime";

/**
 * One messaging thread + its messages (Workstream B9, ADR-0044) — a THIN
 * composition over the tested `handleGetThread` service (uniform anti-oracle
 * 404, sensitive-denial audit, decrypted bodies below the boundary — hence
 * `no-store`). Fails closed 503 when unconfigured; 401 until Clerk composes.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

/** GET /api/messages/threads/[threadId] → the thread and its messages. */
export async function GET(
  _request: Request,
  context: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const deps = composeMessagingDeps(process.env);
  if (!deps) return notConfiguredResponse();

  const { threadId } = await context.params;
  return messagingResponse(await handleGetThread(deps, { threadId }));
}
