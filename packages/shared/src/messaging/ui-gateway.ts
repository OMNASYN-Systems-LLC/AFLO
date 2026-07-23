import type { ThreadStatus } from "@aflo/rules";
import type { ClientThreadView, ConversationThread, Message } from "../domain/messaging";
import {
  isDemoRuntimePermitted,
  resolveAuthMode,
  resolveRepositoryMode,
  type EnvLike,
} from "../runtime/runtime";
import type {
  AfloStore,
  MarkReadResult,
  MessageResult,
  MessagingDenialCode,
  ThreadResult,
} from "../store/store";

/**
 * Messaging UI data-access seam (Workstream B10, ADR-0046).
 *
 * ONE narrow contract for everything the staff and portal messaging UI does —
 * list a client's conversations, open a thread, reply, mark read, set thread
 * status — with TWO implementations selected by the EXISTING runtime contract
 * (ADR-0017, demo opt-in flipped by ADR-0048; no parallel flag system):
 *
 *   - EXPLICIT demo runtime (`APP_ENV=demo`, or automated tests) →
 *     `StoreStaffMessagingGateway` / `StorePortalMessagingGateway` (this
 *     module): the exact `AfloStore` calls the pages/actions made before the
 *     seam existed — behavior unchanged.
 *   - clerk + postgres runtime → the route-service-backed gateways in
 *     `@aflo/database` (`messaging-ui-gateway.ts`), which invoke the SAME
 *     tested handlers behind `/api/messages/...` (ADR-0044) so authorization
 *     lives in exactly one place.
 *   - anything else (ambiguous/partial config) → `unavailable`: no gateway is
 *     selected and every operation fails closed — never demo data (ADR-0048).
 *
 * THE ANTI-ORACLE RULE, PRESERVED END TO END (ADR-0036/0044): the result
 * vocabulary has NO "denied" variant. A denial is not representable to the UI
 * — it surfaces as the same `not_found` a genuinely missing thread produces,
 * so no rendering path can ever distinguish the two.
 */

/**
 * What a messaging operation produced, in UI vocabulary. `signed_out` is the
 * 401 analogue (the UI renders its signed-out state), `not_found` the uniform
 * 404 (rendered as not-found — NEVER as "access denied"), `rejected` a
 * post-authorization kernel/validation code (400/409 — stable, safe to show),
 * `unavailable` the 503 fail-closed analogue (runtime not fully configured).
 */
export type MessagingUiResult<T> =
  | { kind: "ok"; value: T }
  | { kind: "signed_out" }
  | { kind: "not_found" }
  | { kind: "rejected"; code: string }
  | { kind: "unavailable" };

/** One thread as the STAFF messaging card renders it. */
export interface StaffConversationView {
  thread: ConversationThread;
  messages: Message[];
  /** Client messages not yet read by staff (the staff-side unread badge). */
  unread: number;
}

/** The operations the staff messaging UI performs. Identity is NEVER a parameter. */
export interface StaffMessagingGateway {
  listClientConversations(clientId: string): Promise<MessagingUiResult<StaffConversationView[]>>;
  /** Open a thread with its initial staff message. */
  openThread(clientId: string, subject: string, body: string): Promise<MessagingUiResult<ConversationThread>>;
  postReply(threadId: string, body: string): Promise<MessagingUiResult<Message>>;
  /** Mark the thread's client messages read; resolves the count transitioned. */
  markThreadRead(threadId: string): Promise<MessagingUiResult<number>>;
  setThreadStatus(threadId: string, action: "close" | "reopen"): Promise<MessagingUiResult<ThreadStatus>>;
}

/**
 * The operations the client-portal messaging UI performs. The portal
 * projection is deliberately id-free (`ClientThreadView`), so mutations target
 * a thread by its POSITION in the client's own newest-active-first
 * conversation list — the implementation re-resolves that list server-side
 * from the session, so a tampered index can only ever land inside the
 * caller's own threads. Results are `void`: the portal never receives a raw
 * `Message` (which carries staff sender ids).
 */
export interface PortalMessagingGateway {
  listConversations(): Promise<MessagingUiResult<ClientThreadView[]>>;
  sendReply(threadIndex: number, body: string): Promise<MessagingUiResult<void>>;
  markThreadRead(threadIndex: number): Promise<MessagingUiResult<void>>;
}

// ---------------------------------------------------------------------------
// Runtime selection — derived from the EXISTING contract, never a new flag
// ---------------------------------------------------------------------------

export type MessagingUiRuntime = "demo" | "persistent" | "unavailable";

/**
 * Which seam implementation this process uses, derived from the canonical
 * runtime contract (`resolveAuthMode`/`resolveRepositoryMode`, ADR-0017 as
 * flipped by ADR-0048):
 *
 *   - clerk + postgres → the persistent route-service path;
 *   - the EXPLICIT demo opt-in (`APP_ENV=demo`, or automated tests) → the
 *     demo/synthetic store path;
 *   - anything else → `unavailable`: the runtime is ambiguous or partially
 *     selected, and every operation must answer the 503-shaped `unavailable`
 *     result — NEVER demo data. Demo stopped being the fallback with
 *     ADR-0048; it is now a deliberate selection, exactly like production.
 *
 * Mirrors `isMessagingRouteConfigured` (ADR-0044): once the REAL runtime is
 * selected, a missing URL/key must also fail closed (`unavailable`).
 */
export function resolveMessagingUiRuntime(env: EnvLike): MessagingUiRuntime {
  if (resolveAuthMode(env) === "clerk" && resolveRepositoryMode(env) === "postgres") {
    return "persistent";
  }
  return isDemoRuntimePermitted(env) ? "demo" : "unavailable";
}

// ---------------------------------------------------------------------------
// Demo/synthetic implementations — the store path, byte-for-byte the calls
// the UI made before the seam existed
// ---------------------------------------------------------------------------

/** The staff identity the demo runtime resolves server-side (never the browser). */
export interface StaffMessagingIdentity {
  organizationId: string;
  staffId: string;
}

/** The client identity the demo runtime resolves server-side (never the browser). */
export interface ClientMessagingIdentity {
  organizationId: string;
  clientId: string;
}

/**
 * Map a store outcome into the seam vocabulary. Store denials render as the
 * SAME `not_found` the persistent path's uniform 404 produces (anti-oracle
 * parity); `INVALID_INPUT` and kernel reason codes stay distinct `rejected`
 * codes — post-authorization, like the routes' stable `MSG_*` codes.
 */
function fromStoreOutcome<T>(
  outcome: { ok: boolean; denialCode?: MessagingDenialCode; reasonCode?: string },
  value: () => T,
): MessagingUiResult<T> {
  if (outcome.ok) return { kind: "ok", value: value() };
  if (outcome.denialCode === "INVALID_INPUT") return { kind: "rejected", code: "INVALID_INPUT" };
  if (outcome.denialCode) return { kind: "not_found" };
  return { kind: "rejected", code: outcome.reasonCode ?? "INVALID_INPUT" };
}

/** Staff gateway over the in-memory `AfloStore` (demo/synthetic runtime only). */
export class StoreStaffMessagingGateway implements StaffMessagingGateway {
  constructor(
    private readonly store: AfloStore,
    /** Server-resolved session accessor — identity never comes from a caller. */
    private readonly session: () => Promise<StaffMessagingIdentity>,
  ) {}

  async listClientConversations(clientId: string): Promise<MessagingUiResult<StaffConversationView[]>> {
    const { organizationId } = await this.session();
    const views = this.store.conversationsFor(organizationId, clientId).map((thread) => ({
      thread,
      messages: this.store.messagesForThread(organizationId, thread.id),
      unread: this.store.unreadCountForStaff(organizationId, thread.id),
    }));
    return { kind: "ok", value: views };
  }

  async openThread(clientId: string, subject: string, body: string): Promise<MessagingUiResult<ConversationThread>> {
    const { organizationId, staffId } = await this.session();
    const result: ThreadResult = this.store.openThread({
      organizationId,
      clientId,
      subject,
      body,
      actorStaffId: staffId,
    });
    return fromStoreOutcome(result, () => result.thread!);
  }

  async postReply(threadId: string, body: string): Promise<MessagingUiResult<Message>> {
    const { organizationId, staffId } = await this.session();
    const result: MessageResult = this.store.postReply({
      organizationId,
      threadId,
      senderRole: "staff",
      senderId: staffId,
      body,
    });
    return fromStoreOutcome(result, () => result.message!);
  }

  async markThreadRead(threadId: string): Promise<MessagingUiResult<number>> {
    const { organizationId, staffId } = await this.session();
    const result: MarkReadResult = this.store.markThreadRead({
      organizationId,
      threadId,
      readerRole: "staff",
      readerId: staffId,
    });
    return fromStoreOutcome(result, () => result.messagesRead);
  }

  async setThreadStatus(threadId: string, action: "close" | "reopen"): Promise<MessagingUiResult<ThreadStatus>> {
    const { organizationId, staffId } = await this.session();
    const input = { organizationId, threadId, actorStaffId: staffId };
    const result: ThreadResult =
      action === "close" ? this.store.closeThread(input) : this.store.reopenThread(input);
    return fromStoreOutcome(result, () => result.thread!.status);
  }
}

/** Portal gateway over the in-memory `AfloStore` (demo/synthetic runtime only). */
export class StorePortalMessagingGateway implements PortalMessagingGateway {
  constructor(
    private readonly store: AfloStore,
    /** Server-resolved session accessor — identity never comes from a caller. */
    private readonly session: () => Promise<ClientMessagingIdentity>,
  ) {}

  async listConversations(): Promise<MessagingUiResult<ClientThreadView[]>> {
    const { organizationId, clientId } = await this.session();
    return { kind: "ok", value: this.store.clientConversationsFor(organizationId, clientId) };
  }

  async sendReply(threadIndex: number, body: string): Promise<MessagingUiResult<void>> {
    const { organizationId, clientId } = await this.session();
    // Re-resolve the client's OWN threads server-side; index into that list only
    // (same order as the rendered projection: newest-active first).
    const thread = this.store.conversationsFor(organizationId, clientId)[threadIndex];
    if (!thread) return { kind: "not_found" }; // stale/tampered index — never a foreign thread
    const result = this.store.postReply({
      organizationId,
      threadId: thread.id,
      senderRole: "client",
      senderId: clientId,
      body,
    });
    return fromStoreOutcome(result, () => undefined);
  }

  async markThreadRead(threadIndex: number): Promise<MessagingUiResult<void>> {
    const { organizationId, clientId } = await this.session();
    const thread = this.store.conversationsFor(organizationId, clientId)[threadIndex];
    if (!thread) return { kind: "not_found" };
    const result = this.store.markThreadRead({
      organizationId,
      threadId: thread.id,
      readerRole: "client",
      readerId: clientId,
    });
    return fromStoreOutcome(result, () => undefined);
  }
}
