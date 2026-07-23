import { handleCreateThread, handleListThreads } from "@aflo/database";
import {
  composeMessagingDeps,
  invalidJsonResponse,
  messagingResponse,
  notConfiguredResponse,
  readJsonObject,
} from "@/lib/messaging-runtime";

/**
 * Messaging threads (Workstream B9, ADR-0044) — THIN compositions over the
 * tested `handleCreateThread` / `handleListThreads` services. All logic
 * (session-derived org, engine authorization, uniform anti-oracle 404,
 * mandatory sensitive-denial audit) lives in `@aflo/database/services`; this
 * file only builds deps from env and FAILS CLOSED (503) when the real runtime
 * is not configured (see lib/messaging-runtime.ts). Until the Clerk closure
 * is composed, every request answers 401.
 */

export const dynamic = "force-dynamic";
// node:crypto + pg require the Node.js runtime — pinned against config drift.
export const runtime = "nodejs";

/** POST /api/messages/threads → open a thread. */
export async function POST(request: Request): Promise<Response> {
  const deps = composeMessagingDeps(process.env);
  if (!deps) return notConfiguredResponse();

  const input = await readJsonObject(request);
  if (!input) return invalidJsonResponse();

  return messagingResponse(await handleCreateThread(deps, input));
}

/** GET /api/messages/threads?clientId=… → a client's threads. */
export async function GET(request: Request): Promise<Response> {
  const deps = composeMessagingDeps(process.env);
  if (!deps) return notConfiguredResponse();

  const clientId = new URL(request.url).searchParams.get("clientId") ?? undefined;
  return messagingResponse(await handleListThreads(deps, { clientId }));
}
