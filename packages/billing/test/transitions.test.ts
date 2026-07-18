import { describe, expect, it } from "vitest";
import {
  BILLING_RULES_VERSION,
  invoiceTransition,
  isInvoicePastDue,
  paymentTransition,
  subscriptionTransition,
} from "../src/transitions";

const NOW = new Date("2026-07-18T12:00:00Z");
const day = 86_400_000;

describe("invoice transitions", () => {
  it("allows the finalize and settle path", () => {
    expect(invoiceTransition("draft", "open").allowed).toBe(true);
    expect(invoiceTransition("open", "paid").allowed).toBe(true);
    expect(invoiceTransition("open", "void").allowed).toBe(true);
    expect(invoiceTransition("open", "uncollectible").allowed).toBe(true);
    expect(invoiceTransition("uncollectible", "paid").allowed).toBe(true);
  });

  it("rejects illegal, terminal, and no-op moves with reason codes", () => {
    expect(invoiceTransition("draft", "paid")).toMatchObject({ allowed: false, reasonCode: "BR_ILLEGAL_TRANSITION" });
    expect(invoiceTransition("paid", "open")).toMatchObject({ allowed: false, reasonCode: "BR_TERMINAL_STATE" });
    expect(invoiceTransition("void", "paid")).toMatchObject({ allowed: false, reasonCode: "BR_TERMINAL_STATE" });
    expect(invoiceTransition("open", "open")).toMatchObject({ allowed: false, reasonCode: "BR_SAME_STATE" });
  });

  it("tags every result with the rule version", () => {
    expect(invoiceTransition("draft", "open").ruleVersion).toBe(BILLING_RULES_VERSION);
  });
});

describe("subscription transitions", () => {
  it("allows the lifecycle and recovery paths", () => {
    expect(subscriptionTransition("trialing", "active").allowed).toBe(true);
    expect(subscriptionTransition("active", "past_due").allowed).toBe(true);
    expect(subscriptionTransition("past_due", "active").allowed).toBe(true);
    expect(subscriptionTransition("active", "paused").allowed).toBe(true);
    expect(subscriptionTransition("paused", "active").allowed).toBe(true);
    expect(subscriptionTransition("active", "canceled").allowed).toBe(true);
  });

  it("rejects illegal and terminal moves", () => {
    expect(subscriptionTransition("trialing", "past_due")).toMatchObject({ allowed: false, reasonCode: "BR_ILLEGAL_TRANSITION" });
    expect(subscriptionTransition("canceled", "active")).toMatchObject({ allowed: false, reasonCode: "BR_TERMINAL_STATE" });
    expect(subscriptionTransition("paused", "past_due")).toMatchObject({ allowed: false, reasonCode: "BR_ILLEGAL_TRANSITION" });
  });
});

describe("payment transitions", () => {
  it("allows the charge path and retry after failure", () => {
    expect(paymentTransition("requires_payment_method", "processing").allowed).toBe(true);
    expect(paymentTransition("processing", "succeeded").allowed).toBe(true);
    expect(paymentTransition("processing", "failed").allowed).toBe(true);
    expect(paymentTransition("failed", "processing").allowed).toBe(true);
  });

  it("treats succeeded and canceled as terminal", () => {
    expect(paymentTransition("succeeded", "processing")).toMatchObject({ allowed: false, reasonCode: "BR_TERMINAL_STATE" });
    expect(paymentTransition("canceled", "processing")).toMatchObject({ allowed: false, reasonCode: "BR_TERMINAL_STATE" });
  });
});

describe("isInvoicePastDue", () => {
  it("is true only for an open invoice past its due date", () => {
    const due = new Date(NOW.getTime() - day).toISOString(); // yesterday
    expect(isInvoicePastDue("open", due, NOW)).toBe(true);
    expect(isInvoicePastDue("paid", due, NOW)).toBe(false);
    expect(isInvoicePastDue("draft", due, NOW)).toBe(false);
  });

  it("honors a grace window", () => {
    const due = new Date(NOW.getTime() - 3 * day).toISOString();
    expect(isInvoicePastDue("open", due, NOW, 5)).toBe(false); // within 5-day grace
    expect(isInvoicePastDue("open", due, NOW, 2)).toBe(true); // past 2-day grace
  });

  it("is false for an open invoice not yet due", () => {
    const due = new Date(NOW.getTime() + day).toISOString();
    expect(isInvoicePastDue("open", due, NOW)).toBe(false);
  });

  it("rejects an unparseable due date", () => {
    expect(() => isInvoicePastDue("open", "not-a-date", NOW)).toThrow(TypeError);
  });
});
