import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";
import { permissionsForRole, type Role, type SessionContext, type SessionContextProvider } from "@aflo/auth";
import type { ConversationThread, Message, MessagingRepository } from "@aflo/shared";

import {
  MessageRejectedError,
  NotThreadClientError,
  ThreadNotFoundError,
  ThreadTransitionError,
} from "../src/repositories/messaging";
import { AuthorizedMessagingService } from "../src/services/authorized-messaging";
import type { MessagingRouteDeps } from "../src/services/messaging-routes";
import {
  RouteServicePortalMessagingGateway,
  RouteServiceStaffMessagingGateway,
} from "../src/services/messaging-ui-gateway";

/**
 * Workstream B10 (ADR-0046) — the persistent messaging-UI gateways, the
 * clerk+postgres side of the seam. What is under test here is the SEAM
 * contract, not a fake end-to-end:
 *   - unconfigured runtime (null deps) → `unavailable` on EVERY operation
 *     (the routes' 503 analogue; never a demo fallback),
 *   - postgres mode WITHOUT a session (the Clerk closure uncomposed — today's
 *     production reality) → `signed_out` on EVERY operation, with the
 *     messaging service provably untouched (fail closed),
 *   - the anti-oracle rule THROUGH the seam: a denial deep-equals a missing
 *     thread (`not_found`, no denied variant exists),
 *   - the portal projection stays client-safe (id-free) in persistent mode.
 * The handlers themselves are exhaustively proven in messaging-routes.test.ts.
 */

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const NOW = new Date("2026-07-23T12:00:00.000Z");

const clientA1 = randomUUID();
const clientA2 = randomUUID();
const staffMemberId = randomUUID();

/** Honest in-memory MessagingRepository (same contracts as the Drizzle repo). */
class MemoryMessagingRepository implements MessagingRepository {
  threads: ConversationThread[] = [];
  messages: Message[] = [];

  private find(organizationId: string, threadId: string): ConversationThread | null {
    return this.threads.find((t) => t.id === threadId && t.organizationId === organizationId) ?? null;
  }

  async createThread(
    organizationId: string,
    input: { clientId: string; subject: string },
    now: Date,
  ): Promise<ConversationThread> {
    const thread: ConversationThread = {
      id: randomUUID(),
      organizationId,
      clientId: input.clientId,
      subject: input.subject,
      status: "open",
      createdAt: now.toISOString(),
      lastMessageAt: null,
    };
    this.threads.push(thread);
    return thread;
  }

  async getThread(organizationId: string, threadId: string): Promise<ConversationThread | null> {
    return this.find(organizationId, threadId);
  }

  async listThreads(organizationId: string, clientId: string): Promise<ConversationThread[]> {
    return this.threads
      .filter((t) => t.organizationId === organizationId && t.clientId === clientId)
      .sort((a, b) => (b.lastMessageAt ?? b.createdAt).localeCompare(a.lastMessageAt ?? a.createdAt));
  }

  async postMessage(
    organizationId: string,
    input: { threadId: string; senderRole: "staff" | "client"; senderId: string; body: string },
    now: Date,
  ): Promise<Message> {
    const thread = this.find(organizationId, input.threadId);
    if (!thread) throw new ThreadNotFoundError(input.threadId);
    if (input.senderRole === "client" && input.senderId !== thread.clientId) throw new NotThreadClientError();
    if (thread.status === "closed") throw new MessageRejectedError("MSG_THREAD_CLOSED");
    if (input.body.trim().length === 0) throw new MessageRejectedError("MSG_EMPTY_BODY");
    const message: Message = {
      id: randomUUID(),
      threadId: thread.id,
      organizationId,
      clientId: thread.clientId, // DERIVED from the thread, as in the real repo
      senderRole: input.senderRole,
      senderId: input.senderId,
      body: input.body,
      sentAt: now.toISOString(),
      readByClientAt: input.senderRole === "client" ? now.toISOString() : null,
      readByStaffAt: input.senderRole === "staff" ? now.toISOString() : null,
    };
    this.messages.push(message);
    thread.lastMessageAt = now.toISOString();
    return message;
  }

  async listMessages(organizationId: string, threadId: string): Promise<Message[]> {
    return this.messages
      .filter((m) => m.threadId === threadId && m.organizationId === organizationId)
      .sort((a, b) => a.sentAt.localeCompare(b.sentAt));
  }

  async markThreadRead(
    organizationId: string,
    threadId: string,
    readerRole: "staff" | "client",
    now: Date,
  ): Promise<number> {
    const counterpart = readerRole === "staff" ? "client" : "staff";
    let updated = 0;
    for (const m of this.messages) {
      if (m.threadId !== threadId || m.organizationId !== organizationId) continue;
      if (m.senderRole !== counterpart) continue;
      if (readerRole === "staff" && m.readByStaffAt === null) {
        m.readByStaffAt = now.toISOString();
        updated += 1;
      } else if (readerRole === "client" && m.readByClientAt === null) {
        m.readByClientAt = now.toISOString();
        updated += 1;
      }
    }
    return updated;
  }

  async setThreadStatus(
    organizationId: string,
    threadId: string,
    action: "close" | "reopen",
  ): Promise<"open" | "closed"> {
    const thread = this.find(organizationId, threadId);
    if (!thread) throw new ThreadNotFoundError(threadId);
    const to = action === "close" ? "closed" : "open";
    if (thread.status === to) throw new ThreadTransitionError("MSG_ILLEGAL_THREAD_TRANSITION");
    thread.status = to;
    return to;
  }
}

function ctxFor(opts: {
  role: Role;
  organizationId?: string | null;
  membershipId?: string | null;
  linkedClientId?: string | null;
}): SessionContext {
  return {
    sessionId: "sess-test",
    clerkUserId: "ck_test",
    afloUserId: randomUUID(),
    role: opts.role,
    permissions: permissionsForRole(opts.role),
    accountStatus: "active",
    activeOrganizationId: opts.organizationId ?? null,
    activeMembershipId: opts.membershipId ?? null,
    membershipStatus: "active",
    linkedClientId: opts.linkedClientId ?? null,
    assignedClientIds: null,
  };
}

const staffCtx = () => ctxFor({ role: "staff_advisor", organizationId: ORG_A, membershipId: staffMemberId });
const clientA1Ctx = () => ctxFor({ role: "client", organizationId: ORG_A, linkedClientId: clientA1 });

function providerOf(ctx: SessionContext | null): SessionContextProvider {
  return { resolve: async () => ctx };
}

interface Fixture {
  repo: MemoryMessagingRepository;
  deps: MessagingRouteDeps;
  threadA1: string; // client A1's thread
  threadA2: string; // client A2's thread (foreign to client A1)
}

async function fixture(ctx: SessionContext | null): Promise<Fixture> {
  const repo = new MemoryMessagingRepository();
  const service = new AuthorizedMessagingService(repo, { recordSensitiveDenial: async () => {} });
  const threadA1 = (await repo.createThread(ORG_A, { clientId: clientA1, subject: "Welcome A1" }, NOW)).id;
  const threadA2 = (await repo.createThread(ORG_A, { clientId: clientA2, subject: "Welcome A2" }, NOW)).id;
  await repo.postMessage(
    ORG_A,
    { threadId: threadA1, senderRole: "staff", senderId: staffMemberId, body: "Hello from your advisor" },
    NOW,
  );
  return { repo, deps: { sessionProvider: providerOf(ctx), messaging: service, now: () => NOW }, threadA1, threadA2 };
}

/** A messaging service that fails the test on ANY touch (must stay unreached). */
const untouchableService = new Proxy(
  {},
  {
    get() {
      throw new Error("the messaging service must not be touched without a resolved session");
    },
  },
) as AuthorizedMessagingService;

describe("unconfigured real runtime (null deps) — every operation is `unavailable`", () => {
  it("staff gateway: the 503 analogue, never a demo fallback", async () => {
    const gateway = new RouteServiceStaffMessagingGateway(null);
    expect(await gateway.listClientConversations(clientA1)).toEqual({ kind: "unavailable" });
    expect(await gateway.openThread(clientA1, "Subject", "Body")).toEqual({ kind: "unavailable" });
    expect(await gateway.postReply(randomUUID(), "Body")).toEqual({ kind: "unavailable" });
    expect(await gateway.markThreadRead(randomUUID())).toEqual({ kind: "unavailable" });
    expect(await gateway.setThreadStatus(randomUUID(), "close")).toEqual({ kind: "unavailable" });
  });

  it("portal gateway: the 503 analogue, never a demo fallback", async () => {
    const gateway = new RouteServicePortalMessagingGateway(null);
    expect(await gateway.listConversations()).toEqual({ kind: "unavailable" });
    expect(await gateway.sendReply(0, "Body")).toEqual({ kind: "unavailable" });
    expect(await gateway.markThreadRead(0)).toEqual({ kind: "unavailable" });
  });
});

describe("postgres mode WITHOUT a session (Clerk uncomposed) — every operation is `signed_out`", () => {
  const deps: MessagingRouteDeps = {
    sessionProvider: providerOf(null),
    messaging: untouchableService,
    now: () => NOW,
  };

  it("staff gateway fails closed to signed_out on every operation, service untouched", async () => {
    const gateway = new RouteServiceStaffMessagingGateway(deps);
    expect(await gateway.listClientConversations(clientA1)).toEqual({ kind: "signed_out" });
    expect(await gateway.openThread(clientA1, "Subject", "Body")).toEqual({ kind: "signed_out" });
    expect(await gateway.postReply(randomUUID(), "Body")).toEqual({ kind: "signed_out" });
    expect(await gateway.markThreadRead(randomUUID())).toEqual({ kind: "signed_out" });
    expect(await gateway.setThreadStatus(randomUUID(), "close")).toEqual({ kind: "signed_out" });
  });

  it("portal gateway fails closed to signed_out on every operation, service untouched", async () => {
    const gateway = new RouteServicePortalMessagingGateway(deps);
    expect(await gateway.listConversations()).toEqual({ kind: "signed_out" });
    expect(await gateway.sendReply(0, "Body")).toEqual({ kind: "signed_out" });
    expect(await gateway.markThreadRead(0)).toEqual({ kind: "signed_out" });
  });
});

describe("staff gateway over the route services (authorized session)", () => {
  it("lists conversations with messages and the staff unread count", async () => {
    const f = await fixture(staffCtx());
    // A client reply staff haven't read yet.
    await f.repo.postMessage(
      ORG_A,
      { threadId: f.threadA1, senderRole: "client", senderId: clientA1, body: "A question" },
      NOW,
    );
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);

    const result = await gateway.listClientConversations(clientA1);
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.thread.id).toBe(f.threadA1);
    expect(result.value[0]!.messages.map((m) => m.body)).toEqual(["Hello from your advisor", "A question"]);
    expect(result.value[0]!.unread).toBe(1);
  });

  it("openThread composes create + first post exactly like a route-driven client", async () => {
    const f = await fixture(staffCtx());
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);

    const result = await gateway.openThread(clientA1, "New subject", "First message");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    const posted = await f.repo.listMessages(ORG_A, result.value.id);
    expect(posted).toHaveLength(1);
    expect(posted[0]).toMatchObject({ senderRole: "staff", senderId: staffMemberId, body: "First message" });
  });

  it("postReply / markThreadRead / setThreadStatus round-trip", async () => {
    const f = await fixture(staffCtx());
    await f.repo.postMessage(
      ORG_A,
      { threadId: f.threadA1, senderRole: "client", senderId: clientA1, body: "Unread from client" },
      NOW,
    );
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);

    const posted = await gateway.postReply(f.threadA1, "Reply body");
    expect(posted.kind).toBe("ok");
    expect(await gateway.markThreadRead(f.threadA1)).toEqual({ kind: "ok", value: 1 });
    expect(await gateway.setThreadStatus(f.threadA1, "close")).toEqual({ kind: "ok", value: "closed" });
    expect(await gateway.setThreadStatus(f.threadA1, "reopen")).toEqual({ kind: "ok", value: "open" });
  });

  it("kernel rejections keep their distinct stable codes (post-authorization)", async () => {
    const f = await fixture(staffCtx());
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);
    expect(await gateway.postReply(f.threadA1, "   ")).toEqual({ kind: "rejected", code: "MSG_EMPTY_BODY" });
    await gateway.setThreadStatus(f.threadA1, "close");
    expect(await gateway.setThreadStatus(f.threadA1, "close")).toEqual({
      kind: "rejected",
      code: "MSG_ILLEGAL_THREAD_TRANSITION",
    });
  });
});

describe("the anti-oracle rule THROUGH the seam — denial ≡ missing, deep-equal", () => {
  it("a client's denied write to a foreign thread deep-equals a write to an unknown thread", async () => {
    const f = await fixture(clientA1Ctx());
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);

    const denied = await gateway.postReply(f.threadA2, "probe"); // another client's thread → engine denial
    const missing = await gateway.postReply(randomUUID(), "probe"); // no such thread
    expect(denied).toEqual({ kind: "not_found" });
    expect(denied).toEqual(missing);
    // The denied write never landed anywhere.
    expect(await f.repo.listMessages(ORG_A, f.threadA2)).toHaveLength(0);
  });

  it("a client's denied read of a foreign client deep-equals an unknown client (list surface)", async () => {
    const f = await fixture(clientA1Ctx());
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);

    const denied = await gateway.listClientConversations(clientA2);
    const missing = await gateway.listClientConversations(randomUUID());
    expect(denied).toEqual({ kind: "not_found" });
    expect(denied).toEqual(missing);
  });

  it("the seam result vocabulary has NO denied variant to render", async () => {
    const f = await fixture(clientA1Ctx());
    const gateway = new RouteServiceStaffMessagingGateway(f.deps);
    const denied = (await gateway.postReply(f.threadA2, "probe")) as Record<string, unknown>;
    expect(Object.keys(denied)).toEqual(["kind"]); // no reason, no code, no detail
  });
});

describe("portal gateway over the route services (client session)", () => {
  it("lists ONLY the session's own conversations, projected client-safe (id-free)", async () => {
    const f = await fixture(clientA1Ctx());
    const gateway = new RouteServicePortalMessagingGateway(f.deps);

    const result = await gateway.listConversations();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    expect(result.value).toHaveLength(1); // never client A2's thread
    expect(result.value[0]!.subject).toBe("Welcome A1");
    expect(result.value[0]!.messages.map((m) => m.from)).toEqual(["advisor"]);
    expect(result.value[0]!.unreadCount).toBe(1);

    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain(f.threadA1); // no thread id reaches the portal
    expect(serialized).not.toContain(staffMemberId); // no staff sender id
    expect(serialized).not.toContain(ORG_A);
    expect(serialized).not.toContain("senderId");
    expect(serialized).not.toContain("readBy");
  });

  it("sendReply targets by POSITION in the client's own list; markThreadRead marks advisor messages", async () => {
    const f = await fixture(clientA1Ctx());
    const gateway = new RouteServicePortalMessagingGateway(f.deps);

    expect(await gateway.sendReply(0, "Client reply")).toEqual({ kind: "ok", value: undefined });
    const messages = await f.repo.listMessages(ORG_A, f.threadA1);
    expect(messages.at(-1)).toMatchObject({ senderRole: "client", senderId: clientA1, body: "Client reply" });

    expect(await gateway.markThreadRead(0)).toEqual({ kind: "ok", value: undefined });
    expect(await gateway.markThreadRead(0)).toEqual({ kind: "ok", value: undefined }); // idempotent
  });

  it("a stale/tampered index is not_found and never reaches a foreign thread", async () => {
    const f = await fixture(clientA1Ctx());
    const gateway = new RouteServicePortalMessagingGateway(f.deps);
    expect(await gateway.sendReply(7, "probe")).toEqual({ kind: "not_found" });
    expect(await gateway.markThreadRead(7)).toEqual({ kind: "not_found" });
    expect(await f.repo.listMessages(ORG_A, f.threadA2)).toHaveLength(0);
  });

  it("a resolved session with NO linked client is uniform not_found (indistinguishable from denial)", async () => {
    const f = await fixture(ctxFor({ role: "client", organizationId: ORG_A, linkedClientId: null }));
    const gateway = new RouteServicePortalMessagingGateway(f.deps);
    expect(await gateway.listConversations()).toEqual({ kind: "not_found" });
    expect(await gateway.sendReply(0, "probe")).toEqual({ kind: "not_found" });
    expect(await gateway.markThreadRead(0)).toEqual({ kind: "not_found" });
  });
});
