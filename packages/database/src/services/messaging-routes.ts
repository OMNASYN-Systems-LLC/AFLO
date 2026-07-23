import type { SessionContextProvider } from "@aflo/auth";
import type { ThreadStatus } from "@aflo/rules";
import { createAesGcmFieldCipher, parseFieldEncryptionKey, type FieldCipher } from "@aflo/security";
import type { ConversationThread, Message } from "@aflo/shared";
import { resolveAuthMode, resolveRepositoryMode } from "@aflo/shared";
import { isDatabaseConfigured, isResolverConfigured } from "../config";
import {
  MessageRejectedError,
  MessagingClientNotFoundError,
  NotThreadClientError,
  ThreadNotFoundError,
  ThreadTransitionError,
} from "../repositories/messaging";
import {
  AuthorizedMessagingService,
  MessagingAccessDeniedError,
} from "./authorized-messaging";

/**
 * Messaging route services (Workstream B9, ADR-0044) — the credential-free
 * cores behind `/api/messages/threads...`, in the B4/B6 pattern (ADR-0039,
 * ADR-0042): everything environment-shaped is INJECTED (session provider, the
 * authorization-gated messaging service, clock); the Next.js routes only
 * compose from env and fail closed 503 when the real runtime is not fully
 * configured. Tests drive these handlers with stub session providers + the
 * real repositories on PGlite.
 *
 * THE ANTI-ORACLE RULE (ADR-0036, deep-equality-tested): every
 * `MessagingAccessDeniedError` — and every unknown/foreign/defensive
 * not-found (`null` thread, `ThreadNotFoundError`, `NotThreadClientError`) —
 * surfaces as the SAME 404 body (`UNIFORM_NOT_FOUND`). A denial is
 * byte-identical to a genuinely missing thread, so same-org id probing gains
 * no existence oracle. The distinct denial reason lives ONLY in the internal
 * audit record the service emits before throwing (founder decision 4).
 *
 * Post-authorization kernel rejections keep DISTINCT stable codes (the
 * invitation-route precedent for post-terminal states): the caller has
 * already proven access to the thread, so `MSG_THREAD_CLOSED` /
 * `MSG_EMPTY_BODY` / `MSG_BODY_TOO_LONG` (400) and
 * `MSG_ILLEGAL_THREAD_TRANSITION` (409) reveal nothing an authorized caller
 * cannot already see, and real users need them to act.
 *
 * The organization is ALWAYS the session's — no handler accepts an org, and
 * the service's method signatures cannot even express one (ADR-0036).
 */

type Env = Record<string, string | undefined>;

/**
 * Whether the real messaging runtime is fully configured (the routes' 503
 * gate, extracted here so it is testable credential-free): clerk auth mode +
 * postgres repositories + both role-scoped connection URLs + the field
 * encryption key for message bodies (ADR-0028). The demo/synthetic runtime
 * NEVER serves persistent messaging.
 */
export function isMessagingRouteConfigured(env: Env): boolean {
  const key = env.FIELD_ENCRYPTION_KEY;
  return (
    resolveAuthMode(env) === "clerk" &&
    resolveRepositoryMode(env) === "postgres" &&
    isDatabaseConfigured(env) &&
    isResolverConfigured(env) &&
    typeof key === "string" &&
    key.trim() !== ""
  );
}

/**
 * The message-body cipher from `FIELD_ENCRYPTION_KEY` (ADR-0028), or null when
 * the key is missing OR malformed — the caller must fail closed (503), never
 * run a partial runtime. Kept beside the configured-check so the two gates
 * cannot drift.
 */
export function messagingCipherFromEnv(env: Env): FieldCipher | null {
  const key = env.FIELD_ENCRYPTION_KEY;
  if (typeof key !== "string" || key.trim() === "") return null;
  try {
    return createAesGcmFieldCipher(parseFieldEncryptionKey(key.trim()));
  } catch {
    return null;
  }
}

export interface MessagingRouteDeps {
  sessionProvider: SessionContextProvider;
  /** The authorization gate (ADR-0036) — routes NEVER touch the repository directly. */
  messaging: AuthorizedMessagingService;
  now: () => Date;
}

interface ErrorBody {
  ok: false;
  error: string;
}

export type MessagingRouteResult<TOk> =
  | { status: 200 | 201; body: TOk }
  | { status: 400 | 401 | 404 | 409; body: ErrorBody };

/** The ONE uniform 404 — a fresh object per response, identical shape always. */
function notFound<TOk>(): MessagingRouteResult<TOk> {
  return { status: 404, body: { ok: false, error: "not_found" } };
}

function unauthenticated<TOk>(): MessagingRouteResult<TOk> {
  return { status: 401, body: { ok: false, error: "unauthenticated" } };
}

function badRequest<TOk>(error: string): MessagingRouteResult<TOk> {
  return { status: 400, body: { ok: false, error } };
}

/** A required non-empty string field, or null. Never trims ids into new values. */
function nonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether a present id is a well-formed UUID. A syntactically invalid id can
 * denote no row by construction, so handlers render it as the SAME uniform 404
 * an unknown id produces (never a driver cast error, never a distinct code).
 */
function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/**
 * Map a service failure to the uniform external surface. Denials and every
 * not-found-shaped rejection are the SAME 404 (anti-oracle); kernel
 * rejections keep their stable codes; anything else rethrows (a real fault
 * must surface as a 500, never a fabricated success).
 */
function toRouteFailure<TOk>(err: unknown): MessagingRouteResult<TOk> {
  if (
    err instanceof MessagingAccessDeniedError ||
    err instanceof ThreadNotFoundError ||
    err instanceof NotThreadClientError ||
    // A foreign/unknown client id (RLS-invisible) must be indistinguishable
    // from a denied one — the same uniform 404.
    err instanceof MessagingClientNotFoundError
  ) {
    return notFound();
  }
  if (err instanceof MessageRejectedError) return badRequest(err.reasonCode);
  if (err instanceof ThreadTransitionError) {
    return { status: 409, body: { ok: false, error: err.reasonCode } };
  }
  throw err;
}

// ---------------------------------------------------------------------------
// POST /api/messages/threads
// ---------------------------------------------------------------------------

export interface CreateThreadRouteInput {
  clientId?: unknown;
  subject?: unknown;
}

export async function handleCreateThread(
  deps: MessagingRouteDeps,
  input: CreateThreadRouteInput,
): Promise<MessagingRouteResult<{ ok: true; thread: ConversationThread }>> {
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return unauthenticated();

  const clientId = nonEmptyString(input.clientId);
  if (!clientId) return badRequest("invalid_client_id");
  if (!isUuid(clientId)) return notFound(); // can denote no client — uniform 404
  const subject = nonEmptyString(input.subject);
  if (!subject) return badRequest("invalid_subject");

  try {
    const thread = await deps.messaging.createThread(ctx, { clientId, subject }, deps.now());
    return { status: 201, body: { ok: true, thread } };
  } catch (err) {
    return toRouteFailure(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/messages/threads?clientId=…
// ---------------------------------------------------------------------------

export async function handleListThreads(
  deps: MessagingRouteDeps,
  query: { clientId?: unknown },
): Promise<MessagingRouteResult<{ ok: true; threads: ConversationThread[] }>> {
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return unauthenticated();

  const clientId = nonEmptyString(query.clientId);
  if (!clientId) return badRequest("invalid_client_id");
  if (!isUuid(clientId)) return notFound(); // can denote no client — uniform 404

  try {
    const threads = await deps.messaging.listThreads(ctx, clientId);
    return { status: 200, body: { ok: true, threads } };
  } catch (err) {
    return toRouteFailure(err);
  }
}

// ---------------------------------------------------------------------------
// GET /api/messages/threads/[threadId]
// ---------------------------------------------------------------------------

export async function handleGetThread(
  deps: MessagingRouteDeps,
  params: { threadId?: unknown },
): Promise<MessagingRouteResult<{ ok: true; thread: ConversationThread; messages: Message[] }>> {
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return unauthenticated();

  const threadId = nonEmptyString(params.threadId);
  if (!threadId) return badRequest("invalid_thread_id");
  if (!isUuid(threadId)) return notFound(); // can denote no thread — uniform 404

  try {
    const thread = await deps.messaging.getThread(ctx, threadId);
    if (!thread) return notFound();
    const messages = await deps.messaging.listMessages(ctx, threadId);
    return { status: 200, body: { ok: true, thread, messages } };
  } catch (err) {
    return toRouteFailure(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/messages/threads/[threadId]/messages
// ---------------------------------------------------------------------------

export interface PostMessageRouteInput {
  body?: unknown;
}

export async function handlePostMessage(
  deps: MessagingRouteDeps,
  params: { threadId?: unknown },
  input: PostMessageRouteInput,
): Promise<MessagingRouteResult<{ ok: true; message: Message }>> {
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return unauthenticated();

  const threadId = nonEmptyString(params.threadId);
  if (!threadId) return badRequest("invalid_thread_id");
  if (!isUuid(threadId)) return notFound(); // can denote no thread — uniform 404
  // Presence/type only — emptiness and length are the kernel's call
  // (MSG_EMPTY_BODY / MSG_BODY_TOO_LONG), re-checked inside the repository.
  if (typeof input.body !== "string") return badRequest("invalid_body");

  try {
    const message = await deps.messaging.postMessage(ctx, { threadId, body: input.body }, deps.now());
    return { status: 201, body: { ok: true, message } };
  } catch (err) {
    return toRouteFailure(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/messages/threads/[threadId]/read
// ---------------------------------------------------------------------------

export async function handleMarkThreadRead(
  deps: MessagingRouteDeps,
  params: { threadId?: unknown },
): Promise<MessagingRouteResult<{ ok: true; updated: number }>> {
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return unauthenticated();

  const threadId = nonEmptyString(params.threadId);
  if (!threadId) return badRequest("invalid_thread_id");
  if (!isUuid(threadId)) return notFound(); // can denote no thread — uniform 404

  try {
    // `markThreadRead` reports 0 for both "unknown thread" and "nothing unread";
    // the route must render an unknown id as the uniform 404, so resolve the
    // thread first (an authorized, RLS-scoped read — denials throw here).
    const thread = await deps.messaging.getThread(ctx, threadId);
    if (!thread) return notFound();
    const updated = await deps.messaging.markThreadRead(ctx, threadId, deps.now());
    return { status: 200, body: { ok: true, updated } };
  } catch (err) {
    return toRouteFailure(err);
  }
}

// ---------------------------------------------------------------------------
// POST /api/messages/threads/[threadId]/status
// ---------------------------------------------------------------------------

export interface SetThreadStatusRouteInput {
  action?: unknown;
}

export async function handleSetThreadStatus(
  deps: MessagingRouteDeps,
  params: { threadId?: unknown },
  input: SetThreadStatusRouteInput,
): Promise<MessagingRouteResult<{ ok: true; status: ThreadStatus }>> {
  const ctx = await deps.sessionProvider.resolve();
  if (!ctx) return unauthenticated();

  const threadId = nonEmptyString(params.threadId);
  if (!threadId) return badRequest("invalid_thread_id");
  if (!isUuid(threadId)) return notFound(); // can denote no thread — uniform 404
  if (input.action !== "close" && input.action !== "reopen") return badRequest("invalid_action");

  try {
    const status = await deps.messaging.setThreadStatus(ctx, threadId, input.action, deps.now());
    return { status: 200, body: { ok: true, status } };
  } catch (err) {
    return toRouteFailure(err);
  }
}
