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
  type MessagingDenialAuditEvent,
  type MessagingDenialAuditSink,
} from "../src/services/authorized-messaging";
import { ThreadNotFoundError } from "../src/repositories/messaging";

/**
 * Workstream B8 / task #61 — the authorization gate over the messaging
 * repository. The repository owns tenant isolation (RLS) + well-formedness;
 * THIS layer owns who-may. Proven with a recording stub: a denied call must
 * never reach the repository, and sender/org identity must be derived from the
 * session, never the caller.
 *
 * Workstream B9 / ADR-0044 (founder decision 4): every denial path emits
 * exactly ONE sensitive-denial audit event carrying the DISTINCT internal
 * reason, while the thrown error (the external surface) is unchanged; an
 * audit-write failure can never suppress the denial.
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
    identity: { afloUserId: "user-staff", clerkUserId: "ck-staff", accountStatus: "active", isPlatformAdmin: false, sessionsInvalidatedBeforeIso: null },
    membership: { membershipId: "mem-staff", organizationId: ORG, memberRole: "staff", status: "active" },
    assignedClientIds: overrides?.assignedClientIds ?? null,
  });
  if (!ctx) throw new Error("staff fixture failed to resolve");
  return ctx;
}

function clientCtx(clientId = "client-1"): SessionContext {
  const ctx = buildSessionContext({
    sessionId: "s-client",
    identity: { afloUserId: "user-client", clerkUserId: "ck-client", accountStatus: "active", isPlatformAdmin: false, sessionsInvalidatedBeforeIso: null },
    clientLink: { clientId, organizationId: ORG },
  });
  if (!ctx) throw new Error("client fixture failed to resolve");
  return ctx;
}

function platformAdminCtx(): SessionContext {
  const ctx = buildSessionContext({
    sessionId: "s-admin",
    identity: { afloUserId: "user-pa", clerkUserId: "ck-pa", accountStatus: "active", isPlatformAdmin: true, sessionsInvalidatedBeforeIso: null },
  });
  if (!ctx) throw new Error("platform admin fixture failed to resolve");
  return ctx;
}

/** In-memory recording audit sink — test double for the REQUIRED audit port. */
class RecordingAuditSink implements MessagingDenialAuditSink {
  events: MessagingDenialAuditEvent[] = [];
  failWith: Error | null = null;

  async recordSensitiveDenial(event: MessagingDenialAuditEvent): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.events.push(event);
  }
}

function setup(threads: ConversationThread[] = [thread("t1", "client-1"), thread("t2", "client-2")]) {
  const repo = new RecordingRepo();
  const sink = new RecordingAuditSink();
  const auditFailures: unknown[] = [];
  for (const t of threads) repo.threads.set(t.id, t);
  return {
    repo,
    sink,
    auditFailures,
    svc: new AuthorizedMessagingService(repo, sink, (err) => auditFailures.push(err)),
  };
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

  it("unknown thread ids: reads null/empty, writes ThreadNotFoundError (routes render BOTH like a denial: 404)", async () => {
    const { svc } = setup();
    expect(await svc.getThread(clientCtx("client-1"), "t-missing")).toBeNull();
    expect(await svc.listMessages(clientCtx("client-1"), "t-missing")).toEqual([]);
    expect(await svc.markThreadRead(clientCtx("client-1"), "t-missing", NOW)).toBe(0);
    await expect(svc.postMessage(clientCtx("client-1"), { threadId: "t-missing", body: "x" }, NOW)).rejects.toThrow(
      ThreadNotFoundError,
    );
    await expect(svc.setThreadStatus(staffCtx(), "t-missing", "close", NOW)).rejects.toThrow(ThreadNotFoundError);
  });

  it("a pending membership is denied at the engine before any write/list", async () => {
    const pending = buildSessionContext({
      sessionId: "s-pending",
      identity: { afloUserId: "user-p", clerkUserId: "ck-p", accountStatus: "active", isPlatformAdmin: false, sessionsInvalidatedBeforeIso: null },
      membership: { membershipId: "mem-p", organizationId: ORG, memberRole: "staff", status: "pending" },
    });
    if (!pending) throw new Error("pending fixture failed to resolve");
    const { repo, svc } = setup();
    await expect(svc.listThreads(pending, "client-1")).rejects.toMatchObject({ reason: "membership_pending" });
    await expect(svc.postMessage(pending, { threadId: "t1", body: "x" }, NOW)).rejects.toMatchObject({
      reason: "membership_pending",
    });
    expect(repo.calls.filter((c) => c.method !== "getThread")).toEqual([]);
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

// ---------------------------------------------------------------------------
// Workstream B9 / ADR-0044 — mandatory sensitive-denial audit emission
// ---------------------------------------------------------------------------

/** A hand-built degenerate/edge SessionContext (states buildSessionContext refuses to mint). */
function rawCtx(overrides: Partial<SessionContext>): SessionContext {
  return {
    sessionId: "s-raw",
    clerkUserId: "ck-raw",
    afloUserId: "user-raw",
    role: "staff_advisor",
    permissions: new Set(),
    accountStatus: "active",
    activeOrganizationId: ORG,
    activeMembershipId: "mem-raw",
    membershipStatus: "active",
    linkedClientId: null,
    assignedClientIds: null,
    ...overrides,
  };
}

describe("AuthorizedMessagingService — sensitive-denial audit emission (founder decision 4)", () => {
  it("client probing another client's THREAD → exactly one wrong_client_access event; external error unchanged", async () => {
    const { sink, svc } = setup();
    await expect(svc.getThread(clientCtx("client-1"), "t2")).rejects.toMatchObject({
      reason: "not_owner",
      permission: "message.read",
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      organizationId: ORG,
      afloUserId: "user-client",
      actorRole: "client",
      actorMembershipId: null,
      actorClientId: "client-1",
      reason: "wrong_client_access",
      engineReason: "not_owner",
      permission: "message.read",
      target: { type: "conversation_thread", id: "t2" },
    });
  });

  it("client acting FOR another client (createThread / listThreads) → ownership_mismatch on the client target", async () => {
    const { sink, svc } = setup();
    await expect(
      svc.createThread(clientCtx("client-1"), { clientId: "client-2", subject: "x" }, NOW),
    ).rejects.toThrow(MessagingAccessDeniedError);
    await expect(svc.listThreads(clientCtx("client-1"), "client-2")).rejects.toThrow(
      MessagingAccessDeniedError,
    );
    expect(sink.events.map((e) => e.reason)).toEqual(["ownership_mismatch", "ownership_mismatch"]);
    expect(sink.events.map((e) => e.target)).toEqual([
      { type: "client", id: "client-2" },
      { type: "client", id: "client-2" },
    ]);
  });

  it("assignment-scoped staff on an unassigned client's thread → staff_assignment_mismatch", async () => {
    const { sink, svc } = setup();
    const scoped = staffCtx({ assignedClientIds: ["client-1"] });
    await expect(svc.getThread(scoped, "t2")).rejects.toMatchObject({ reason: "not_assigned" });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      reason: "staff_assignment_mismatch",
      engineReason: "not_assigned",
      actorMembershipId: "mem-staff",
      target: { type: "conversation_thread", id: "t2" },
    });
  });

  it("pending membership → invalid_organization_context (closest founder category)", async () => {
    const { sink, svc } = setup();
    const pending = buildSessionContext({
      sessionId: "s-pending",
      identity: { afloUserId: "user-p", clerkUserId: "ck-p", accountStatus: "active", isPlatformAdmin: false, sessionsInvalidatedBeforeIso: null },
      membership: { membershipId: "mem-p", organizationId: ORG, memberRole: "staff", status: "pending" },
    });
    if (!pending) throw new Error("pending fixture failed to resolve");
    await expect(svc.listThreads(pending, "client-1")).rejects.toMatchObject({
      reason: "membership_pending",
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      reason: "invalid_organization_context",
      engineReason: "membership_pending",
    });
  });

  it("revoked membership → revoked_membership", async () => {
    const { sink, svc } = setup();
    const revoked = rawCtx({ membershipStatus: "revoked" });
    await expect(svc.getThread(revoked, "t1")).rejects.toMatchObject({
      reason: "membership_revoked",
    });
    expect(sink.events[0]).toMatchObject({
      reason: "revoked_membership",
      engineReason: "membership_revoked",
    });
  });

  it("disabled account → disabled_account (defense in depth below the session layer)", async () => {
    const { sink, svc } = setup();
    const disabled = rawCtx({ accountStatus: "disabled" });
    await expect(svc.getThread(disabled, "t1")).rejects.toMatchObject({
      reason: "account_disabled",
    });
    expect(sink.events[0]).toMatchObject({
      reason: "disabled_account",
      engineReason: "account_disabled",
    });
  });

  it("platform admin probing the tenant surface → platform_admin_cross_tenant_access with a NULL org", async () => {
    const { sink, svc } = setup();
    await expect(svc.getThread(platformAdminCtx(), "t1")).rejects.toMatchObject({
      reason: "no_active_membership",
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      organizationId: null, // the denial IS the missing org context
      reason: "platform_admin_cross_tenant_access",
      engineReason: "no_active_membership",
    });
  });

  it("non-admin session with no active org → invalid_organization_context", async () => {
    const { sink, svc } = setup();
    const orgless = rawCtx({ activeOrganizationId: null, membershipStatus: "none" });
    await expect(svc.listThreads(orgless, "client-1")).rejects.toMatchObject({
      reason: "no_active_membership",
    });
    expect(sink.events[0]).toMatchObject({
      organizationId: null,
      reason: "invalid_organization_context",
      engineReason: "no_active_membership",
    });
  });

  it("client attempting a staff-only close → publication_without_authority", async () => {
    const { sink, svc } = setup();
    await expect(svc.setThreadStatus(clientCtx("client-1"), "t1", "close", NOW)).rejects.toMatchObject({
      reason: "permission_denied",
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      reason: "publication_without_authority",
      engineReason: "permission_denied",
      permission: "message.close",
    });
  });

  it("degenerate staff identity (no membership id) posting → ambiguous_identity", async () => {
    const { sink, svc } = setup();
    const degenerate = rawCtx({ activeMembershipId: null });
    await expect(svc.postMessage(degenerate, { threadId: "t1", body: "x" }, NOW)).rejects.toMatchObject({
      reason: "no_active_membership", // external engine code unchanged
    });
    expect(sink.events).toHaveLength(1);
    expect(sink.events[0]).toMatchObject({
      reason: "ambiguous_identity",
      engineReason: "no_active_membership",
      target: { type: "conversation_thread", id: "t1" },
    });
  });

  it("audit events carry ids/codes only — never a message body or subject", async () => {
    const { sink, svc } = setup();
    await expect(
      svc.postMessage(clientCtx("client-1"), { threadId: "t2", body: "SECRET-BODY-NEVER-AUDITED" }, NOW),
    ).rejects.toThrow(MessagingAccessDeniedError);
    const serialized = JSON.stringify(sink.events);
    expect(serialized).not.toContain("SECRET-BODY-NEVER-AUDITED");
    expect(serialized).not.toContain("Checking in"); // the thread subject
  });

  it("an audit-write FAILURE never suppresses the denial (emit-then-throw, secondary error logged)", async () => {
    const { sink, auditFailures, svc } = setup();
    sink.failWith = new Error("audit store down");
    await expect(svc.getThread(clientCtx("client-1"), "t2")).rejects.toMatchObject({
      reason: "not_owner",
    });
    expect(auditFailures).toEqual([sink.failWith]);
  });

  it("happy paths and plain not-found emit NOTHING (denials only, no noise)", async () => {
    const { sink, svc } = setup();
    await svc.getThread(staffCtx(), "t1");
    await svc.listThreads(clientCtx("client-1"), "client-1");
    await svc.postMessage(staffCtx(), { threadId: "t1", body: "hello" }, NOW);
    await svc.markThreadRead(clientCtx("client-1"), "t1", NOW);
    expect(await svc.getThread(staffCtx(), "t-missing")).toBeNull(); // not-found ≠ denial
    await expect(svc.postMessage(staffCtx(), { threadId: "t-missing", body: "x" }, NOW)).rejects.toThrow(
      ThreadNotFoundError,
    );
    expect(sink.events).toEqual([]);
  });
});
