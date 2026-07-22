import { describe, expect, it } from "vitest";
import { buildSessionContext, type SessionContext } from "@aflo/auth";
import type {
  ConversationThread,
  CreateThreadInput,
  Message,
  MessagingRepository,
  PostMessageInput,
} from "@aflo/shared";
import type { MessageSenderRole, ThreadStatus } from "@aflo/rules";
import {
  AuthorizedMessagingService,
  MessagingAccessDeniedError,
} from "../src/services/authorized-messaging";
import { ThreadNotFoundError } from "../src/repositories/messaging";

/**
 * Workstream B8 / task #61 — the authorization gate over the messaging
 * repository. The repository owns tenant isolation (RLS) + well-formedness;
 * THIS layer owns who-may. Proven with a recording stub: a denied call must
 * never reach the repository, and sender/org identity must be derived from the
 * session, never the caller.
 */

const NOW = new Date("2026-07-22T12:00:00.000Z");
const ORG = "org-1";

function thread(id: string, clientId: string, status: ThreadStatus = "open"): ConversationThread {
  return {
    id,
    organizationId: ORG,
    clientId,
    subject: "Checking in",
    status,
    createdAt: NOW.toISOString(),
    lastMessageAt: null,
  };
}

/** In-memory recording stub — NOT a runtime fallback; test double only. */
class RecordingRepo implements MessagingRepository {
  calls: { method: string; args: unknown[] }[] = [];
  threads = new Map<string, ConversationThread>();

  private record(method: string, args: unknown[]): void {
    this.calls.push({ method, args });
  }

  async createThread(organizationId: string, input: CreateThreadInput, now: Date): Promise<ConversationThread> {
    this.record("createThread", [organizationId, input, now]);
    return thread("t-new", input.clientId);
  }
  async getThread(organizationId: string, threadId: string): Promise<ConversationThread | null> {
    this.record("getThread", [organizationId, threadId]);
    return this.threads.get(threadId) ?? null;
  }
  async listThreads(organizationId: string, clientId: string): Promise<ConversationThread[]> {
    this.record("listThreads", [organizationId, clientId]);
    return [...this.threads.values()].filter((t) => t.clientId === clientId);
  }
  async postMessage(organizationId: string, input: PostMessageInput, now: Date): Promise<Message> {
    this.record("postMessage", [organizationId, input, now]);
    const t = this.threads.get(input.threadId)!;
    return {
      id: "m-new",
      threadId: input.threadId,
      organizationId,
      clientId: t.clientId,
      senderRole: input.senderRole,
      senderId: input.senderId,
      body: input.body,
      sentAt: now.toISOString(),
      readByClientAt: null,
      readByStaffAt: null,
    };
  }
  async listMessages(organizationId: string, threadId: string): Promise<Message[]> {
    this.record("listMessages", [organizationId, threadId]);
    return [];
  }
  async markThreadRead(
    organizationId: string,
    threadId: string,
    readerRole: MessageSenderRole,
    now: Date,
  ): Promise<number> {
    this.record("markThreadRead", [organizationId, threadId, readerRole, now]);
    return 1;
  }
  async setThreadStatus(
    organizationId: string,
    threadId: string,
    action: "close" | "reopen",
    now: Date,
  ): Promise<ThreadStatus> {
    this.record("setThreadStatus", [organizationId, threadId, action, now]);
    return action === "close" ? "closed" : "open";
  }
}

function staffCtx(overrides?: { assignedClientIds?: readonly string[] | null }): SessionContext {
  const ctx = buildSessionContext({
    sessionId: "s-staff",
    identity: { afloUserId: "user-staff", clerkUserId: "ck-staff", accountStatus: "active", isPlatformAdmin: false },
    membership: { membershipId: "mem-staff", organizationId: ORG, memberRole: "staff", status: "active" },
    assignedClientIds: overrides?.assignedClientIds ?? null,
  });
  if (!ctx) throw new Error("staff fixture failed to resolve");
  return ctx;
}

function clientCtx(clientId = "client-1"): SessionContext {
  const ctx = buildSessionContext({
    sessionId: "s-client",
    identity: { afloUserId: "user-client", clerkUserId: "ck-client", accountStatus: "active", isPlatformAdmin: false },
    clientLink: { clientId, organizationId: ORG },
  });
  if (!ctx) throw new Error("client fixture failed to resolve");
  return ctx;
}

function platformAdminCtx(): SessionContext {
  const ctx = buildSessionContext({
    sessionId: "s-admin",
    identity: { afloUserId: "user-pa", clerkUserId: "ck-pa", accountStatus: "active", isPlatformAdmin: true },
  });
  if (!ctx) throw new Error("platform admin fixture failed to resolve");
  return ctx;
}

function setup(threads: ConversationThread[] = [thread("t1", "client-1"), thread("t2", "client-2")]) {
  const repo = new RecordingRepo();
  for (const t of threads) repo.threads.set(t.id, t);
  return { repo, svc: new AuthorizedMessagingService(repo) };
}

describe("AuthorizedMessagingService — org + sender are structurally server-derived", () => {
  it("uses the SESSION's org for every repo call (no org parameter exists to forge)", async () => {
    const { repo, svc } = setup();
    await svc.listThreads(staffCtx(), "client-1");
    expect(repo.calls[0]).toEqual({ method: "listThreads", args: [ORG, "client-1"] });
  });

  it("postMessage derives sender identity from the session — a client posts AS their linked client", async () => {
    const { repo, svc } = setup();
    await svc.postMessage(clientCtx("client-1"), { threadId: "t1", body: "hello" }, NOW);
    const post = repo.calls.find((c) => c.method === "postMessage")!;
    expect(post.args[1]).toMatchObject({ senderRole: "client", senderId: "client-1" });
  });

  it("staff post AS their membership id, senderRole staff", async () => {
    const { repo, svc } = setup();
    await svc.postMessage(staffCtx(), { threadId: "t1", body: "hello" }, NOW);
    const post = repo.calls.find((c) => c.method === "postMessage")!;
    expect(post.args[1]).toMatchObject({ senderRole: "staff", senderId: "mem-staff" });
  });

  it("markThreadRead derives the reader role from the session", async () => {
    const { repo, svc } = setup();
    await svc.markThreadRead(clientCtx("client-1"), "t1", NOW);
    const call = repo.calls.find((c) => c.method === "markThreadRead")!;
    expect(call.args[2]).toBe("client");
  });
});

describe("AuthorizedMessagingService — client ownership (not_owner) enforced before the repo", () => {
  it("a client reads/lists/posts only THEIR thread; another same-org client's thread is denied", async () => {
    const { repo, svc } = setup();
    const me = clientCtx("client-1");

    await expect(svc.getThread(me, "t2")).rejects.toThrow(MessagingAccessDeniedError);
    await expect(svc.listThreads(me, "client-2")).rejects.toMatchObject({ reason: "not_owner" });
    await expect(svc.postMessage(me, { threadId: "t2", body: "hi" }, NOW)).rejects.toMatchObject({
      reason: "not_owner",
    });
    // The denied post/list never reached the repository's write/list surface.
    expect(repo.calls.filter((c) => c.method === "postMessage" || c.method === "listThreads")).toEqual([]);

    const mine = await svc.getThread(me, "t1");
    expect(mine?.id).toBe("t1");
  });

  it("a client cannot open a thread FOR another client (createThread ownership)", async () => {
    const { repo, svc } = setup();
    await expect(
      svc.createThread(clientCtx("client-1"), { clientId: "client-2", subject: "x" }, NOW),
    ).rejects.toMatchObject({ reason: "not_owner" });
    expect(repo.calls.filter((c) => c.method === "createThread")).toEqual([]);
    // ...but for themselves it works (self-service).
    await svc.createThread(clientCtx("client-1"), { clientId: "client-1", subject: "x" }, NOW);
    expect(repo.calls.at(-1)?.method).toBe("createThread");
  });

  it("unknown thread ids read as null/empty (no denial oracle for non-existent records)", async () => {
    const { svc } = setup();
    expect(await svc.getThread(clientCtx("client-1"), "t-missing")).toBeNull();
    expect(await svc.listMessages(clientCtx("client-1"), "t-missing")).toEqual([]);
    expect(await svc.markThreadRead(clientCtx("client-1"), "t-missing", NOW)).toBe(0);
    await expect(svc.postMessage(clientCtx("client-1"), { threadId: "t-missing", body: "x" }, NOW)).rejects.toThrow(
      ThreadNotFoundError,
    );
  });
});

describe("AuthorizedMessagingService — staff scoping + role policy", () => {
  it("assignment scoping: staff assigned to client-1 cannot touch client-2's thread", async () => {
    const { svc } = setup();
    const scoped = staffCtx({ assignedClientIds: ["client-1"] });
    await expect(svc.getThread(scoped, "t2")).rejects.toMatchObject({ reason: "not_assigned" });
    expect((await svc.getThread(scoped, "t1"))?.id).toBe("t1");
  });

  it("unscoped staff see every client in their org (matrix default)", async () => {
    const { svc } = setup();
    expect((await svc.getThread(staffCtx(), "t2"))?.id).toBe("t2");
  });

  it("close/reopen is message.close — staff allowed, client denied permission_denied", async () => {
    const { svc } = setup();
    await expect(svc.setThreadStatus(clientCtx("client-1"), "t1", "close", NOW)).rejects.toMatchObject({
      reason: "permission_denied",
    });
    expect(await svc.setThreadStatus(staffCtx(), "t1", "close", NOW)).toBe("closed");
  });

  it("platform admin has NO tenant binding — messaging fails closed (audited surface later)", async () => {
    const { repo, svc } = setup();
    await expect(svc.getThread(platformAdminCtx(), "t1")).rejects.toMatchObject({
      reason: "no_active_membership",
    });
    expect(repo.calls).toEqual([]); // never reached the repository at all
  });
});
