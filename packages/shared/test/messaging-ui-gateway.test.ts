import { describe, expect, it } from "vitest";
import { syntheticDatabase } from "../src/data/synthetic";
import {
  resolveMessagingUiRuntime,
  StorePortalMessagingGateway,
  StoreStaffMessagingGateway,
} from "../src/messaging/ui-gateway";
import { MockPortalRepository } from "../src/repositories/mock";
import { AfloStore } from "../src/store";

/**
 * Messaging UI seam (Workstream B10, ADR-0046) — runtime selection off the
 * EXISTING contract (never a new flag) and the demo/store gateways proven to
 * be EXACTLY the store path the pages used before the seam existed. The
 * persistent (route-service) implementations are proven in
 * `@aflo/database/test/messaging-ui-gateway.test.ts`.
 */

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-23T12:00:00.000Z");

const staffSession = async () => ({ organizationId: ORG, staffId: "s-lin" });
const clientSession = async () => ({ organizationId: ORG, clientId: "c-bell" });

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

describe("resolveMessagingUiRuntime — selection by the EXISTING runtime contract", () => {
  it("defaults to the demo/store path (empty env, demo auth, memory repositories)", () => {
    expect(resolveMessagingUiRuntime({})).toBe("demo");
    expect(resolveMessagingUiRuntime({ AUTH_MODE: "demo", REPOSITORY_MODE: "memory" })).toBe("demo");
  });

  it("selects persistent ONLY when auth is clerk AND repositories are postgres", () => {
    expect(resolveMessagingUiRuntime({ AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres" })).toBe("persistent");
    expect(resolveMessagingUiRuntime({ AUTH_MODE: "clerk" })).toBe("demo");
    expect(resolveMessagingUiRuntime({ REPOSITORY_MODE: "postgres" })).toBe("demo");
    expect(resolveMessagingUiRuntime({ AUTH_MODE: "clerk", REPOSITORY_MODE: "memory" })).toBe("demo");
    expect(resolveMessagingUiRuntime({ AUTH_MODE: "demo", REPOSITORY_MODE: "postgres" })).toBe("demo");
  });

  it("uses the canonical resolvers' normalization (case/whitespace)", () => {
    expect(resolveMessagingUiRuntime({ AUTH_MODE: " Clerk ", REPOSITORY_MODE: "POSTGRES" })).toBe("persistent");
  });
});

describe("StoreStaffMessagingGateway — demo mode IS the store path, unchanged", () => {
  it("lists a client's conversations exactly as the pre-seam page composition did", async () => {
    const store = makeStore();
    const gateway = new StoreStaffMessagingGateway(store, staffSession);

    const result = await gateway.listClientConversations("c-solomon");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");

    // Byte-for-byte the former inline composition: conversationsFor +
    // messagesForThread + unreadCountForStaff per thread.
    const expected = store.conversationsFor(ORG, "c-solomon").map((thread) => ({
      thread,
      messages: store.messagesForThread(ORG, thread.id),
      unread: store.unreadCountForStaff(ORG, thread.id),
    }));
    expect(result.value).toEqual(expected);
    expect(result.value[0]!.unread).toBe(1); // the seeded unread client message
  });

  it("unknown client lists empty (ok) — the demo read path has no denial concept", async () => {
    const gateway = new StoreStaffMessagingGateway(makeStore(), staffSession);
    expect(await gateway.listClientConversations("c-nope")).toEqual({ kind: "ok", value: [] });
  });

  it("openThread creates the thread with its initial staff message (same store write as before)", async () => {
    const store = makeStore();
    const gateway = new StoreStaffMessagingGateway(store, staffSession);

    const result = await gateway.openThread("c-grant", "Quarterly check-in", "Let's find a time.");
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");
    const messages = store.messagesForThread(ORG, result.value.id);
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ senderRole: "staff", senderId: "s-lin", body: "Let's find a time." });
  });

  it("postReply/markThreadRead/setThreadStatus mutate through the same store workflow", async () => {
    const store = makeStore();
    const gateway = new StoreStaffMessagingGateway(store, staffSession);

    const posted = await gateway.postReply("th-solomon-docs", "Pay stubs look good.");
    expect(posted.kind).toBe("ok");
    expect(store.messagesForThread(ORG, "th-solomon-docs").at(-1)).toMatchObject({
      senderRole: "staff",
      senderId: "s-lin",
      body: "Pay stubs look good.",
    });

    const read = await gateway.markThreadRead("th-solomon-docs");
    expect(read).toEqual({ kind: "ok", value: 1 });
    expect(store.unreadCountForStaff(ORG, "th-solomon-docs")).toBe(0);

    expect(await gateway.setThreadStatus("th-solomon-docs", "close")).toEqual({ kind: "ok", value: "closed" });
    expect(await gateway.setThreadStatus("th-solomon-docs", "reopen")).toEqual({ kind: "ok", value: "open" });
  });

  it("a store denial surfaces as the SAME not_found a missing thread produces (anti-oracle parity)", async () => {
    const gateway = new StoreStaffMessagingGateway(makeStore(), staffSession);
    expect(await gateway.postReply("th-nope", "hello")).toEqual({ kind: "not_found" });
    expect(await gateway.markThreadRead("th-nope")).toEqual({ kind: "not_found" });
    expect(await gateway.setThreadStatus("th-nope", "close")).toEqual({ kind: "not_found" });
    expect(await gateway.openThread("c-nope", "Subject", "Body")).toEqual({ kind: "not_found" });
  });

  it("post-authorization rejections keep distinct stable codes", async () => {
    const store = makeStore();
    const gateway = new StoreStaffMessagingGateway(store, staffSession);
    expect(await gateway.openThread("c-grant", "   ", "Body")).toEqual({
      kind: "rejected",
      code: "INVALID_INPUT",
    });
    const empty = await gateway.postReply("th-solomon-docs", "   ");
    expect(empty.kind).toBe("rejected");
    await gateway.setThreadStatus("th-solomon-docs", "close");
    const closed = await gateway.postReply("th-solomon-docs", "hello?");
    expect(closed.kind).toBe("rejected");
  });
});

describe("StorePortalMessagingGateway — demo mode IS the portal store path, unchanged", () => {
  it("lists the SAME client-safe projection the portal view rendered before the seam", async () => {
    const store = makeStore();
    const gateway = new StorePortalMessagingGateway(store, clientSession);

    const result = await gateway.listConversations();
    expect(result.kind).toBe("ok");
    if (result.kind !== "ok") throw new Error("unreachable");

    expect(result.value).toEqual(store.clientConversationsFor(ORG, "c-bell"));
    const view = await new MockPortalRepository(store.database()).getPortalView(ORG, "c-bell", NOW);
    expect(result.value).toEqual(view!.conversations);

    // Client-safe: no ids, no staff sender ids, no read receipts.
    const serialized = JSON.stringify(result.value);
    expect(serialized).not.toContain("s-lin");
    expect(serialized).not.toContain("th-bell-welcome");
    expect(serialized).not.toContain("senderId");
    expect(serialized).not.toContain("readBy");
  });

  it("sendReply targets by POSITION in the client's own list and posts as the client", async () => {
    const store = makeStore();
    const gateway = new StorePortalMessagingGateway(store, clientSession);

    expect(await gateway.sendReply(0, "One more question about next steps.")).toEqual({
      kind: "ok",
      value: undefined,
    });
    expect(store.messagesForThread(ORG, "th-bell-welcome").at(-1)).toMatchObject({
      senderRole: "client",
      senderId: "c-bell",
      body: "One more question about next steps.",
    });
  });

  it("a stale/tampered index is not_found and never reaches a foreign thread", async () => {
    const store = makeStore();
    const gateway = new StorePortalMessagingGateway(store, clientSession);
    const before = store.messagesForThread(ORG, "th-solomon-docs").length;

    expect(await gateway.sendReply(7, "hello")).toEqual({ kind: "not_found" });
    expect(await gateway.markThreadRead(7)).toEqual({ kind: "not_found" });
    // c-bell has exactly one thread; no other thread gained a message.
    expect(store.messagesForThread(ORG, "th-solomon-docs")).toHaveLength(before);
  });

  it("markThreadRead marks only advisor messages, idempotently", async () => {
    const store = makeStore();
    // Reset the seeded advisor read receipt so there is something unread.
    const gateway = new StorePortalMessagingGateway(store, clientSession);
    const seeded = store.messagesForThread(ORG, "th-bell-welcome").find((m) => m.senderRole === "staff")!;
    seeded.readByClientAt = null;

    expect(await gateway.markThreadRead(0)).toEqual({ kind: "ok", value: undefined });
    expect(store.unreadCountForClient(ORG, "c-bell")).toBe(0);
    // Idempotent no-op stays ok (matches the pre-seam action's behavior).
    expect(await gateway.markThreadRead(0)).toEqual({ kind: "ok", value: undefined });
  });
});
