import { handleSetThreadStatus } from "@aflo/database";
import {
  composeMessagingDeps,
  invalidJsonResponse,
  messagingResponse,
  notConfiguredResponse,
  readJsonObject,
} from "@/lib/messaging-runtime";

/**
 * Close/reopen a thread (Workstream B9, ADR-0044) — a THIN composition over
 * the tested `handleSetThreadStatus` service (`message.close`, staff-side
 * roles only per policy; denials render the uniform anti-oracle 404 and are
 * audited internally with their distinct reason — a client attempting a close
 * is `publication_without_authority`). Fails closed 503 when unconfigured;
 * 401 until Clerk composes.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

/** POST /api/messages/threads/[threadId]/status → { action: "close" | "reopen" }. */
export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const deps = composeMessagingDeps(process.env);
  if (!deps) return notConfiguredResponse();

  const input = await readJsonObject(request);
  if (!input) return invalidJsonResponse();

  const { threadId } = await context.params;
  return messagingResponse(await handleSetThreadStatus(deps, { threadId }, input));
}
