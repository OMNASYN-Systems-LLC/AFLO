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
