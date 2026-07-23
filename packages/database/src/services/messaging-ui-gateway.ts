import type {
  ClientThreadView,
  ConversationThread,
  Message,
  MessagingUiResult,
  PortalMessagingGateway,
  StaffConversationView,
  StaffMessagingGateway,
} from "@aflo/shared";
import { toClientThreadView } from "@aflo/shared";
import type { ThreadStatus } from "@aflo/rules";
import {
  handleCreateThread,
  handleGetThread,
  handleListThreads,
  handleMarkThreadRead,
  handlePostMessage,
  handleSetThreadStatus,
  type MessagingRouteDeps,
  type MessagingRouteResult,
} from "./messaging-routes";

/**
 * Persistent messaging gateways for the UI seam (Workstream B10, ADR-0046) —
 * the clerk+postgres implementations of `@aflo/shared`'s
 * `StaffMessagingGateway` / `PortalMessagingGateway`.
 *
 * DIRECT SERVICE INVOCATION, NOT SELF-FETCH: server components and server
 * actions invoke the SAME tested route-service handlers the six
 * `/api/messages/...` routes are thin compositions over (`handleListThreads`,
 * `handleGetThread`, `handlePostMessage`, `handleMarkThreadRead`,
 * `handleSetThreadStatus`, `handleCreateThread` — ADR-0044), composed from
 * the SAME `MessagingRouteDeps`. That keeps behavior identical to the HTTP
 * surface (identical session resolution, identical uniform anti-oracle 404,
 * identical stable 400/409 codes) with ZERO duplicated authorization and no
 * host/cookie plumbing for an in-process hop.
 *
 * Result mapping is mechanical and total:
 *   401 → `signed_out` · 404 → `not_found` (NEVER distinguishable as a
 *   denial) · 400/409 → `rejected(code)` · null deps → `unavailable` (the
 *   routes' 503 `not_configured` analogue — the real runtime misconfigured
 *   NEVER falls back to demo data).
 *
 * Today `clerkSessionSource()` yields no session, so every operation resolves
 * `signed_out` — production stays inert and fail-closed until Clerk composes.
 */

/** Map a route-service result onto the seam vocabulary (mechanical, total). */
function fromRouteResult<TOk, TValue>(
  result: MessagingRouteResult<TOk>,
  value: (body: TOk) => TValue,
): MessagingUiResult<TValue> {
  switch (result.status) {
    case 200:
    case 201:
      return { kind: "ok", value: value(result.body) };
    case 401:
      return { kind: "signed_out" };
    case 404:
      return { kind: "not_found" };
    case 400:
    case 409:
      return { kind: "rejected", code: result.body.error };
  }
}

/** The 503-analogue result for an unconfigured real runtime. */
function unavailable<T>(): MessagingUiResult<T> {
  return { kind: "unavailable" };
}

/**
 * Load a client's threads WITH their messages by composing the two read
 * handlers (list, then per-thread get — each call independently authorized by
 * the service; ADR-0036). Any failure short-circuits with that failure.
 */
async function loadConversations(
  deps: MessagingRouteDeps,
  clientId: string,
): Promise<MessagingUiResult<{ thread: ConversationThread; messages: Message[] }[]>> {
  const listed = await handleListThreads(deps, { clientId });
  if (listed.status !== 200) return fromRouteResult(listed, () => []);
  const conversations: { thread: ConversationThread; messages: Message[] }[] = [];
  for (const thread of listed.body.threads) {
    const detail = await handleGetThread(deps, { threadId: thread.id });
    if (detail.status !== 200) return fromRouteResult(detail, () => []);
    conversations.push({ thread: detail.body.thread, messages: detail.body.messages });
  }
  return { kind: "ok", value: conversations };
}

/**
 * Staff gateway over the messaging route services. Constructed with the deps
 * `composeMessagingDeps(env)` yields — or null, in which case every operation
 * answers `unavailable` (fail closed, exactly like the routes' 503).
 */
export class RouteServiceStaffMessagingGateway implements StaffMessagingGateway {
  constructor(private readonly deps: MessagingRouteDeps | null) {}

  async listClientConversations(clientId: string): Promise<MessagingUiResult<StaffConversationView[]>> {
    if (!this.deps) return unavailable();
    const loaded = await loadConversations(this.deps, clientId);
    if (loaded.kind !== "ok") return loaded;
    return {
      kind: "ok",
      value: loaded.value.map(({ thread, messages }) => ({
        thread,
        messages,
        // Same semantics as the demo store's staff unread count: client
        // messages not yet read by staff.
        unread: messages.filter((m) => m.senderRole === "client" && m.readByStaffAt === null).length,
      })),
    };
  }

  async openThread(clientId: string, subject: string, body: string): Promise<MessagingUiResult<ConversationThread>> {
    if (!this.deps) return unavailable();
    // The route surface splits "open a thread with its first message" into
    // create + post (the same two calls a route-driven client makes). A
    // failed post leaves an empty open thread — visible, re-postable, never
    // partial data (documented in ADR-0046).
    const created = await handleCreateThread(this.deps, { clientId, subject });
    if (created.status !== 201) return fromRouteResult(created, (b) => b.thread);
    const posted = await handlePostMessage(this.deps, { threadId: created.body.thread.id }, { body });
    if (posted.status !== 201) return fromRouteResult(posted, () => created.body.thread);
    return { kind: "ok", value: created.body.thread };
  }

  async postReply(threadId: string, body: string): Promise<MessagingUiResult<Message>> {
    if (!this.deps) return unavailable();
    return fromRouteResult(await handlePostMessage(this.deps, { threadId }, { body }), (b) => b.message);
  }

  async markThreadRead(threadId: string): Promise<MessagingUiResult<number>> {
    if (!this.deps) return unavailable();
    return fromRouteResult(await handleMarkThreadRead(this.deps, { threadId }), (b) => b.updated);
  }

  async setThreadStatus(threadId: string, action: "close" | "reopen"): Promise<MessagingUiResult<ThreadStatus>> {
    if (!this.deps) return unavailable();
    return fromRouteResult(await handleSetThreadStatus(this.deps, { threadId }, { action }), (b) => b.status);
  }
}

/**
 * Portal gateway over the messaging route services. The session's linked
 * client is the ONLY client it can name (identity plumbing, not
 * authorization — the handlers still authorize every call), and every
 * response is projected through `toClientThreadView` server-side, so the
 * browser stays id-free exactly as in the demo runtime: no thread ids, no
 * staff sender ids, no read receipts. Mutations target a thread by position
 * in the same newest-active-first list the projection renders.
 */
export class RouteServicePortalMessagingGateway implements PortalMessagingGateway {
  constructor(private readonly deps: MessagingRouteDeps | null) {}

  /** The session's own linked client id, or the seam-mapped failure. */
  private async ownClientId(deps: MessagingRouteDeps): Promise<MessagingUiResult<string>> {
    const ctx = await deps.sessionProvider.resolve();
    if (!ctx) return { kind: "signed_out" };
    // A session with no linked client has no portal conversations to name.
    // Uniform `not_found` — indistinguishable from any other denial.
    if (!ctx.linkedClientId) return { kind: "not_found" };
    return { kind: "ok", value: ctx.linkedClientId };
  }

  async listConversations(): Promise<MessagingUiResult<ClientThreadView[]>> {
    if (!this.deps) return unavailable();
    const own = await this.ownClientId(this.deps);
    if (own.kind !== "ok") return own;
    const loaded = await loadConversations(this.deps, own.value);
    if (loaded.kind !== "ok") return loaded;
    return {
      kind: "ok",
      value: loaded.value.map(({ thread, messages }) => toClientThreadView(thread, messages)),
    };
  }

  /** Resolve a position in the client's own thread list to a thread id. */
  private async threadIdAt(deps: MessagingRouteDeps, threadIndex: number): Promise<MessagingUiResult<string>> {
    const own = await this.ownClientId(deps);
    if (own.kind !== "ok") return own;
    const listed = await handleListThreads(deps, { clientId: own.value });
    if (listed.status !== 200) return fromRouteResult(listed, () => "");
    const thread = listed.body.threads[threadIndex];
    if (!thread) return { kind: "not_found" }; // stale/tampered index — never a foreign thread
    return { kind: "ok", value: thread.id };
  }

  async sendReply(threadIndex: number, body: string): Promise<MessagingUiResult<void>> {
    if (!this.deps) return unavailable();
    const target = await this.threadIdAt(this.deps, threadIndex);
    if (target.kind !== "ok") return target;
    return fromRouteResult(
      await handlePostMessage(this.deps, { threadId: target.value }, { body }),
      () => undefined,
    );
  }

  async markThreadRead(threadIndex: number): Promise<MessagingUiResult<void>> {
    if (!this.deps) return unavailable();
    const target = await this.threadIdAt(this.deps, threadIndex);
    if (target.kind !== "ok") return target;
    return fromRouteResult(await handleMarkThreadRead(this.deps, { threadId: target.value }), () => undefined);
  }
}
