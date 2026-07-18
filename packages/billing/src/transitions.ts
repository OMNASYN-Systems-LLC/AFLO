import { MS_PER_DAY } from "@aflo/rules";
import type { InvoiceStatus, PaymentStatus, SubscriptionStatus } from "./status";

/**
 * Deterministic billing state machines (version billing.v1.0.0).
 *
 * Every transition is an allow-list check with a reason code — no implicit
 * transitions, no probabilistic input. `canTransition*` answers whether a
 * move is legal; `assert*Transition` returns a typed result the service
 * layer records. Illegal transitions are rejected with a reason code, never
 * thrown away silently.
 */

export const BILLING_RULES_VERSION = "billing.v1.0.0";

export type BillingReasonCode =
  | "BR_OK"
  | "BR_ILLEGAL_TRANSITION"
  | "BR_TERMINAL_STATE"
  | "BR_SAME_STATE";

export interface TransitionResult<S> {
  allowed: boolean;
  from: S;
  to: S;
  reasonCode: BillingReasonCode;
  ruleVersion: string;
}

/** Invoice lifecycle: draft → open → {paid | void | uncollectible}. */
const INVOICE_TRANSITIONS: Record<InvoiceStatus, readonly InvoiceStatus[]> = {
  draft: ["open", "void"],
  open: ["paid", "void", "uncollectible"],
  paid: [], // terminal
  void: [], // terminal
  uncollectible: ["paid"], // a late payment can still settle an uncollectible invoice
};

/** Subscription lifecycle. */
const SUBSCRIPTION_TRANSITIONS: Record<SubscriptionStatus, readonly SubscriptionStatus[]> = {
  trialing: ["active", "canceled"],
  active: ["past_due", "paused", "canceled"],
  past_due: ["active", "canceled"],
  paused: ["active", "canceled"],
  canceled: [], // terminal
};

/** Payment-intent lifecycle. */
const PAYMENT_TRANSITIONS: Record<PaymentStatus, readonly PaymentStatus[]> = {
  requires_payment_method: ["processing", "canceled"],
  processing: ["succeeded", "failed"],
  failed: ["processing", "canceled"], // retriable
  succeeded: [], // terminal
  canceled: [], // terminal
};

function evaluate<S extends string>(
  table: Record<S, readonly S[]>,
  from: S,
  to: S,
): TransitionResult<S> {
  const base = { from, to, ruleVersion: BILLING_RULES_VERSION };
  if (from === to) {
    return { ...base, allowed: false, reasonCode: "BR_SAME_STATE" };
  }
  const allowedTargets = table[from];
  if (allowedTargets.length === 0) {
    return { ...base, allowed: false, reasonCode: "BR_TERMINAL_STATE" };
  }
  if (!allowedTargets.includes(to)) {
    return { ...base, allowed: false, reasonCode: "BR_ILLEGAL_TRANSITION" };
  }
  return { ...base, allowed: true, reasonCode: "BR_OK" };
}

export function invoiceTransition(from: InvoiceStatus, to: InvoiceStatus): TransitionResult<InvoiceStatus> {
  return evaluate(INVOICE_TRANSITIONS, from, to);
}

export function subscriptionTransition(
  from: SubscriptionStatus,
  to: SubscriptionStatus,
): TransitionResult<SubscriptionStatus> {
  return evaluate(SUBSCRIPTION_TRANSITIONS, from, to);
}

export function paymentTransition(from: PaymentStatus, to: PaymentStatus): TransitionResult<PaymentStatus> {
  return evaluate(PAYMENT_TRANSITIONS, from, to);
}

/**
 * Deterministic past-due check for an open invoice. Purely a function of the
 * due date and the current time — never a stored status, so it cannot drift.
 * Returns false for any non-open invoice.
 */
export function isInvoicePastDue(
  status: InvoiceStatus,
  dueDateIso: string,
  now: Date,
  graceDays = 0,
): boolean {
  if (status !== "open") return false;
  const due = new Date(dueDateIso).getTime();
  if (Number.isNaN(due)) {
    throw new TypeError(`isInvoicePastDue: invalid dueDate "${dueDateIso}"`);
  }
  return now.getTime() > due + graceDays * MS_PER_DAY;
}
