import { describe, expect, it } from "vitest";
import {
  MAX_MESSAGE_BODY_CHARS,
  MESSAGING_RULES_VERSION,
  transitionThread,
  validateMessageDraft,
  type MessageDraft,
} from "../src/messaging";

function draft(overrides: Partial<MessageDraft> = {}): MessageDraft {
  return { senderId: "s-lin", senderRole: "staff", body: "Hello, how did the paperwork go?", ...overrides };
}

describe("validateMessageDraft", () => {
  it("accepts a well-formed draft on an open thread and returns the trimmed body", () => {
    const res = validateMessageDraft(draft({ body: "  spaced out  " }), "open");
    expect(res).toMatchObject({ ok: true, reasonCode: "MSG_OK", ruleVersion: MESSAGING_RULES_VERSION });
    expect(res.normalizedBody).toBe("spaced out");
  });

  it("rejects a missing sender", () => {
    expect(validateMessageDraft(draft({ senderId: "  " }), "open").reasonCode).toBe("MSG_MISSING_SENDER");
  });

  it("rejects any message to a closed thread", () => {
    const res = validateMessageDraft(draft(), "closed");
    expect(res.ok).toBe(false);
    expect(res.reasonCode).toBe("MSG_THREAD_CLOSED");
    expect(res.normalizedBody).toBeNull();
  });

  it("rejects an empty or whitespace-only body", () => {
    expect(validateMessageDraft(draft({ body: "" }), "open").reasonCode).toBe("MSG_EMPTY_BODY");
    expect(validateMessageDraft(draft({ body: "   \n\t " }), "open").reasonCode).toBe("MSG_EMPTY_BODY");
  });

  it("rejects a body over the length cap (measured after trim)", () => {
    const justOver = "x".repeat(MAX_MESSAGE_BODY_CHARS + 1);
    expect(validateMessageDraft(draft({ body: justOver }), "open").reasonCode).toBe("MSG_BODY_TOO_LONG");
    const exactly = "x".repeat(MAX_MESSAGE_BODY_CHARS);
    expect(validateMessageDraft(draft({ body: exactly }), "open").ok).toBe(true);
  });
});

describe("transitionThread", () => {
  it("closes an open thread and reopens a closed one", () => {
    expect(transitionThread("open", "close")).toMatchObject({ ok: true, status: "closed" });
    expect(transitionThread("closed", "reopen")).toMatchObject({ ok: true, status: "open" });
  });

  it("rejects illegal moves and leaves the status unchanged", () => {
    const closeClosed = transitionThread("closed", "close");
    expect(closeClosed.ok).toBe(false);
    expect(closeClosed.reasonCode).toBe("MSG_ILLEGAL_THREAD_TRANSITION");
    expect(closeClosed.status).toBe("closed");
    expect(transitionThread("open", "reopen").reasonCode).toBe("MSG_ILLEGAL_THREAD_TRANSITION");
  });
});
