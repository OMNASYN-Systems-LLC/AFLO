import { describe, expect, it } from "vitest";
import { toClientThreadView, type ConversationThread, type Message } from "../src/domain/messaging";

const thread: ConversationThread = {
  id: "t1",
  organizationId: "org-golden-key",
  clientId: "c-solomon",
  subject: "Mortgage paperwork",
  status: "open",
  createdAt: "2026-07-10T09:00:00.000Z",
  lastMessageAt: "2026-07-12T10:00:00.000Z",
};

function msg(overrides: Partial<Message>): Message {
  return {
    id: "m",
    threadId: "t1",
    organizationId: "org-golden-key",
    clientId: "c-solomon",
    senderRole: "staff",
    senderId: "s-lin",
    body: "Please upload your latest paystub.",
    sentAt: "2026-07-11T09:00:00.000Z",
    readByClientAt: null,
    readByStaffAt: null,
    ...overrides,
  };
}

describe("toClientThreadView — client-safe projection", () => {
  it("shows the client's own messages as 'you' and staff messages as 'advisor'", () => {
    const view = toClientThreadView(thread, [
      msg({ id: "m1", senderRole: "staff", senderId: "s-lin", body: "Please upload your paystub.", sentAt: "2026-07-11T09:00:00.000Z" }),
      msg({ id: "m2", senderRole: "client", senderId: "c-solomon", body: "Just did — thanks!", sentAt: "2026-07-11T12:00:00.000Z" }),
    ]);
    expect(view.subject).toBe("Mortgage paperwork");
    expect(view.messages).toEqual([
      { from: "advisor", body: "Please upload your paystub.", sentAt: "2026-07-11T09:00:00.000Z" },
      { from: "you", body: "Just did — thanks!", sentAt: "2026-07-11T12:00:00.000Z" },
    ]);
  });

  it("NEVER exposes staff identity or internal fields (only from/body/sentAt)", () => {
    const view = toClientThreadView(thread, [msg({ senderId: "s-lin" })]);
    const serialized = JSON.stringify(view);
    expect(serialized).not.toContain("s-lin"); // no staff member id
    expect(serialized).not.toContain("org-golden-key"); // no tenant internal
    expect(serialized).not.toContain("senderId");
    expect(serialized).not.toContain("readBy");
    expect(Object.keys(view.messages[0]!)).toEqual(["from", "body", "sentAt"]);
  });

  it("orders messages by time and defensively drops any not belonging to the thread", () => {
    const view = toClientThreadView(thread, [
      msg({ id: "late", body: "second", sentAt: "2026-07-12T09:00:00.000Z" }),
      msg({ id: "early", body: "first", sentAt: "2026-07-11T09:00:00.000Z" }),
      msg({ id: "foreign", threadId: "OTHER", body: "should not appear", sentAt: "2026-07-11T10:00:00.000Z" }),
    ]);
    expect(view.messages.map((m) => m.body)).toEqual(["first", "second"]);
  });

  it("renders an empty thread with no messages", () => {
    expect(toClientThreadView(thread, [])).toEqual({
      subject: "Mortgage paperwork",
      status: "open",
      messages: [],
    });
  });
});
