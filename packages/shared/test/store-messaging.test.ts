import { describe, expect, it } from "vitest";
import { AfloStore } from "../src/store";
import { deserializeEvent } from "../src/events";
import { syntheticDatabase } from "../src/data/synthetic";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

/** The MessagePosted events currently in the outbox, decoded. */
function messagePostedPayloads(store: AfloStore) {
  return store.outbox
    .filter((r) => r.eventType === "MessagePosted")
    .map((r) => deserializeEvent(r.serializedEvent).payload as unknown as Record<string, unknown>);
}

describe("messaging reads (tenant-scoped)", () => {
  it("lists a client's seeded threads and their messages in order", () => {
    const store = makeStore();
    const threads = store.conversationsFor(ORG, "c-solomon");
    expect(threads.map((t) => t.id)).toContain("th-solomon-docs");
    const messages = store.messagesForThread(ORG, "th-solomon-docs");
    expect(messages.map((m) => m.id)).toEqual(["msg-solomon-1", "msg-solomon-2"]);
  });

  it("fails closed on org scope: a foreign org sees no threads or messages", () => {
    const store = makeStore();
    expect(store.conversationsFor("org-not-mine", "c-solomon")).toEqual([]);
    expect(store.messagesForThread("org-not-mine", "th-solomon-docs")).toEqual([]);
    expect(store.conversationsFor(ORG, "c-nope")).toEqual([]);
  });

  it("client projection leaks no staff id, org id, or internal fields", () => {
    const store = makeStore();
    const views = store.clientConversationsFor(ORG, "c-solomon");
    expect(views.length).toBeGreaterThan(0);
    const serialized = JSON.stringify(views);
    expect(serialized).not.toContain("s-lin"); // staff sender id
    expect(serialized).not.toContain(ORG); // tenant id
    expect(serialized).not.toContain("senderId");
    expect(serialized).not.toContain("readBy");
    // The client's own message reads as "you"; the advisor's as "advisor".
    expect(views[0]!.messages.map((m) => m.from)).toEqual(["advisor", "you"]);
  });
});

describe("openThread / postReply (rules-gated, audited, event-emitting)", () => {
  it("opens a thread with an initial staff message and emits MessagePosted", () => {
    const store = makeStore();
    const auditBefore = store.auditFor(ORG).length;
    const res = store.openThread({
      organizationId: ORG,
      clientId: "c-bell",
      subject: "Welcome",
      body: "Hi — reach out here any time.",
      actorStaffId: "s-lin",
    });
    expect(res.ok).toBe(true);
    expect(res.thread?.status).toBe("open");
    expect(res.message?.senderRole).toBe("staff");
    expect(res.emittedEventIds).toHaveLength(1);
    expect(store.auditFor(ORG).length).toBe(auditBefore + 1);
    expect(store.conversationsFor(ORG, "c-bell").map((t) => t.id)).toContain(res.thread!.id);
  });

  it("staff and the thread's own client can both reply", () => {
    const store = makeStore();
    const staff = store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-lin", body: "Got them, thank you!" });
    expect(staff.ok).toBe(true);
    const client = store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "client", senderId: "c-solomon", body: "Great." });
    expect(client.ok).toBe(true);
    expect(store.messagesForThread(ORG, "th-solomon-docs").length).toBe(4);
  });

  it("the MessagePosted event carries NO message body (sensitive content stays out of the outbox)", () => {
    const store = makeStore();
    store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-lin", body: "SENSITIVE-SECRET-BODY" });
    const payloads = messagePostedPayloads(store);
    expect(payloads.length).toBeGreaterThan(0);
    const last = payloads[payloads.length - 1]!;
    expect(last).toMatchObject({ threadId: "th-solomon-docs", clientId: "c-solomon", senderRole: "staff" });
    expect(JSON.stringify(last)).not.toContain("SENSITIVE-SECRET-BODY");
  });

  it("rejects an empty body via the kernel reason code", () => {
    const store = makeStore();
    expect(store.openThread({ organizationId: ORG, clientId: "c-bell", subject: "x", body: "   ", actorStaffId: "s-lin" }).reasonCode).toBe("MSG_EMPTY_BODY");
    expect(store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-lin", body: "" }).reasonCode).toBe("MSG_EMPTY_BODY");
  });
});

describe("messaging tenant isolation + authorization (fail-closed)", () => {
  it("a foreign org cannot post to a thread (THREAD_NOT_FOUND)", () => {
    const store = makeStore();
    const res = store.postReply({ organizationId: "org-not-mine", threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-lin", body: "hi" });
    expect(res.ok).toBe(false);
    expect(res.denialCode).toBe("THREAD_NOT_FOUND");
  });

  it("a client cannot post to another client's thread (NOT_THREAD_CLIENT)", () => {
    const store = makeStore();
    const res = store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "client", senderId: "c-bell", body: "sneaky" });
    expect(res.ok).toBe(false);
    expect(res.denialCode).toBe("NOT_THREAD_CLIENT");
  });

  it("unknown client / unknown actor are refused", () => {
    const store = makeStore();
    expect(store.openThread({ organizationId: ORG, clientId: "c-nope", subject: "x", body: "hi", actorStaffId: "s-lin" }).denialCode).toBe("CLIENT_NOT_FOUND");
    expect(store.openThread({ organizationId: ORG, clientId: "c-bell", subject: "x", body: "hi", actorStaffId: "s-ghost" }).denialCode).toBe("ACTOR_NOT_IN_ORG");
  });

  it("no write leaves an audit or event behind when it is denied", () => {
    const store = makeStore();
    const auditBefore = store.auditFor(ORG).length;
    const outboxBefore = store.outbox.length;
    store.postReply({ organizationId: "org-not-mine", threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-lin", body: "hi" });
    store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "client", senderId: "c-bell", body: "sneaky" });
    expect(store.auditFor(ORG).length).toBe(auditBefore);
    expect(store.outbox.length).toBe(outboxBefore);
  });
});

describe("messaging isolation across TWO populated orgs (non-tautological)", () => {
  // The base seed has one org, so a read with a foreign org id returns [] only
  // because that org has no rows. Seed a SECOND populated org so isolation is
  // proven against real cross-tenant data, not an empty set.
  const ORG_B = "org-rival";
  function twoOrgStore() {
    const seed = structuredClone(syntheticDatabase);
    seed.clients.push({
      id: "c-rival",
      organizationId: ORG_B,
      kind: "client",
      pipelineStageId: "active",
      clientStatus: "active",
      firstName: "Rhea",
      lastName: "Vasquez",
      email: "rhea@example.test",
      phone: "555-0100",
      assignedStaffId: "s-rival",
      joinedAt: "2026-06-01T00:00:00.000Z",
      lastActivityAt: "2026-07-15T00:00:00.000Z",
    });
    seed.conversationThreads.push({
      id: "th-rival",
      organizationId: ORG_B,
      clientId: "c-rival",
      subject: "Rival org thread",
      status: "open",
      createdAt: "2026-07-01T00:00:00.000Z",
      lastMessageAt: "2026-07-01T00:00:00.000Z",
    });
    seed.messages.push({
      id: "msg-rival-1",
      threadId: "th-rival",
      organizationId: ORG_B,
      clientId: "c-rival",
      senderRole: "staff",
      senderId: "s-rival",
      body: "rival-only content",
      sentAt: "2026-07-01T00:00:00.000Z",
      readByClientAt: null,
      readByStaffAt: "2026-07-01T00:00:00.000Z",
    });
    return new AfloStore(seed, () => NOW);
  }

  it("org B (populated) cannot READ org A's thread or messages, and vice versa", () => {
    const store = twoOrgStore();
    // Each org sees only its own.
    expect(store.conversationsFor(ORG, "c-solomon").map((t) => t.id)).toContain("th-solomon-docs");
    expect(store.conversationsFor(ORG_B, "c-rival").map((t) => t.id)).toEqual(["th-rival"]);
    // Org B reaching for org A's thread by id gets nothing — not an empty-org artifact.
    expect(store.messagesForThread(ORG_B, "th-solomon-docs")).toEqual([]);
    expect(store.messagesForThread(ORG, "th-rival")).toEqual([]);
    // Cross-org client lookups are empty both directions.
    expect(store.conversationsFor(ORG, "c-rival")).toEqual([]);
    expect(store.conversationsFor(ORG_B, "c-solomon")).toEqual([]);
    // The client projection never crosses tenants.
    const rivalView = JSON.stringify(store.clientConversationsFor(ORG_B, "c-rival"));
    expect(rivalView).not.toContain("th-solomon-docs");
    expect(JSON.stringify(store.clientConversationsFor(ORG, "c-solomon"))).not.toContain("rival-only content");
  });

  it("org B cannot WRITE into org A's thread, and leaves no message/audit/event", () => {
    const store = twoOrgStore();
    const msgsBefore = store.messagesForThread(ORG, "th-solomon-docs").length;
    const auditBefore = store.auditFor(ORG).length;
    const outboxBefore = store.outbox.length;
    // Staff of org B and the org-B client both try to post into org A's thread.
    expect(store.postReply({ organizationId: ORG_B, threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-rival", body: "intrusion" }).denialCode).toBe("THREAD_NOT_FOUND");
    expect(store.postReply({ organizationId: ORG_B, threadId: "th-solomon-docs", senderRole: "client", senderId: "c-rival", body: "intrusion" }).denialCode).toBe("THREAD_NOT_FOUND");
    expect(store.messagesForThread(ORG, "th-solomon-docs").length).toBe(msgsBefore);
    expect(store.auditFor(ORG).length).toBe(auditBefore);
    expect(store.outbox.length).toBe(outboxBefore);
  });
});

describe("read receipts + unread counts (messaging.v1.0.0)", () => {
  /** MessageRead payloads currently in the outbox, decoded. */
  function messageReadPayloads(store: AfloStore) {
    return store.outbox
      .filter((r) => r.eventType === "MessageRead")
      .map((r) => deserializeEvent(r.serializedEvent).payload as unknown as Record<string, unknown>);
  }

  it("counts the client's unread messages awaiting staff", () => {
    const store = makeStore();
    // Seed: msg-solomon-2 is a client message not yet read by staff.
    expect(store.unreadCountForStaff(ORG, "th-solomon-docs")).toBe(1);
  });

  it("staff marking read clears the count, emits MessageRead (count only), and audits", () => {
    const store = makeStore();
    const auditBefore = store.auditFor(ORG).length;
    const res = store.markThreadRead({ organizationId: ORG, threadId: "th-solomon-docs", readerRole: "staff", readerId: "s-lin" });
    expect(res.ok).toBe(true);
    expect(res.messagesRead).toBe(1);
    expect(res.emittedEventIds).toHaveLength(1);
    expect(store.unreadCountForStaff(ORG, "th-solomon-docs")).toBe(0);
    expect(store.auditFor(ORG).length).toBe(auditBefore + 1);
    const payloads = messageReadPayloads(store);
    expect(payloads[payloads.length - 1]).toMatchObject({ threadId: "th-solomon-docs", readerRole: "staff", messageCount: 1 });
    // The read receipt carries no message body.
    expect(JSON.stringify(payloads)).not.toContain("uploaded both");
  });

  it("marking an already-read thread is a traceless idempotent no-op", () => {
    const store = makeStore();
    store.markThreadRead({ organizationId: ORG, threadId: "th-solomon-docs", readerRole: "staff", readerId: "s-lin" });
    const auditAfterFirst = store.auditFor(ORG).length;
    const outboxAfterFirst = store.outbox.length;
    const again = store.markThreadRead({ organizationId: ORG, threadId: "th-solomon-docs", readerRole: "staff", readerId: "s-lin" });
    expect(again.ok).toBe(true);
    expect(again.messagesRead).toBe(0);
    expect(again.emittedEventIds).toHaveLength(0);
    expect(store.auditFor(ORG).length).toBe(auditAfterFirst);
    expect(store.outbox.length).toBe(outboxAfterFirst);
  });

  it("the client can mark advisor messages read; the client projection reflects unread", () => {
    const store = makeStore();
    // Staff posts a fresh reply -> unread for the client until they read it.
    store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "staff", senderId: "s-lin", body: "One more thing." });
    expect(store.unreadCountForClient(ORG, "c-solomon")).toBe(1);
    expect(store.clientConversationsFor(ORG, "c-solomon")[0]!.unreadCount).toBe(1);
    const res = store.markThreadRead({ organizationId: ORG, threadId: "th-solomon-docs", readerRole: "client", readerId: "c-solomon" });
    expect(res.ok).toBe(true);
    expect(res.messagesRead).toBe(1);
    expect(store.unreadCountForClient(ORG, "c-solomon")).toBe(0);
    expect(store.clientConversationsFor(ORG, "c-solomon")[0]!.unreadCount).toBe(0);
  });

  it("cross-tenant and wrong-client mark-read attempts are denied and traceless", () => {
    const store = makeStore();
    const auditBefore = store.auditFor(ORG).length;
    const outboxBefore = store.outbox.length;
    expect(store.markThreadRead({ organizationId: "org-not-mine", threadId: "th-solomon-docs", readerRole: "staff", readerId: "s-lin" }).denialCode).toBe("THREAD_NOT_FOUND");
    expect(store.markThreadRead({ organizationId: ORG, threadId: "th-solomon-docs", readerRole: "client", readerId: "c-bell" }).denialCode).toBe("NOT_THREAD_CLIENT");
    expect(store.auditFor(ORG).length).toBe(auditBefore);
    expect(store.outbox.length).toBe(outboxBefore);
    // No messages were actually read.
    expect(store.unreadCountForStaff(ORG, "th-solomon-docs")).toBe(1);
  });
});

describe("thread close / reopen", () => {
  it("closes a thread, blocks replies to it, then reopens and accepts them", () => {
    const store = makeStore();
    expect(store.closeThread({ organizationId: ORG, threadId: "th-solomon-docs", actorStaffId: "s-lin" }).ok).toBe(true);
    expect(store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "client", senderId: "c-solomon", body: "still there?" }).reasonCode).toBe("MSG_THREAD_CLOSED");
    expect(store.reopenThread({ organizationId: ORG, threadId: "th-solomon-docs", actorStaffId: "s-lin" }).ok).toBe(true);
    expect(store.postReply({ organizationId: ORG, threadId: "th-solomon-docs", senderRole: "client", senderId: "c-solomon", body: "back!" }).ok).toBe(true);
  });

  it("rejects an illegal transition (closing a closed thread)", () => {
    const store = makeStore();
    store.closeThread({ organizationId: ORG, threadId: "th-solomon-docs", actorStaffId: "s-lin" });
    expect(store.closeThread({ organizationId: ORG, threadId: "th-solomon-docs", actorStaffId: "s-lin" }).reasonCode).toBe("MSG_ILLEGAL_THREAD_TRANSITION");
  });
});
