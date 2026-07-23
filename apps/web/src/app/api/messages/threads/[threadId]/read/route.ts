import { handleMarkThreadRead } from "@aflo/database";
import {
  composeMessagingDeps,
  messagingResponse,
  notConfiguredResponse,
} from "@/lib/messaging-runtime";

/**
 * Read receipts (Workstream B9, ADR-0044) — a THIN composition over the
 * tested `handleMarkThreadRead` service. The reader identity is DERIVED from
 * the session (ADR-0036); an unknown thread and a denied one render the same
 * uniform 404 (denials audited internally). Fails closed 503 when
 * unconfigured; 401 until Clerk composes. No request body.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

/** POST /api/messages/threads/[threadId]/read → mark counterparty messages read. */
export async function POST(
  _request: Request,
  context: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const deps = composeMessagingDeps(process.env);
  if (!deps) return notConfiguredResponse();

  const { threadId } = await context.params;
  return messagingResponse(await handleMarkThreadRead(deps, { threadId }));
}
