import { handlePostMessage } from "@aflo/database";
import {
  composeMessagingDeps,
  invalidJsonResponse,
  messagingResponse,
  notConfiguredResponse,
  readJsonObject,
} from "@/lib/messaging-runtime";

/**
 * Post a message (Workstream B9, ADR-0044) — a THIN composition over the
 * tested `handlePostMessage` service. The sender is DERIVED from the session
 * (never the request body — ADR-0036), the body is encrypted at rest below
 * the repository boundary (ADR-0028), and denials render as the uniform
 * anti-oracle 404 while the distinct reason is audited internally. Fails
 * closed 503 when unconfigured; 401 until Clerk composes.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

/** POST /api/messages/threads/[threadId]/messages → append a message. */
export async function POST(
  request: Request,
  context: { params: Promise<{ threadId: string }> },
): Promise<Response> {
  const deps = composeMessagingDeps(process.env);
  if (!deps) return notConfiguredResponse();

  const input = await readJsonObject(request);
  if (!input) return invalidJsonResponse();

  const { threadId } = await context.params;
  return messagingResponse(await handlePostMessage(deps, { threadId }, input));
}
