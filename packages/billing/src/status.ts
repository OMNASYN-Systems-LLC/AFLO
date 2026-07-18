/**
 * Billing status vocabularies for AFLO.
 *
 * These mirror Stripe's status names so the future Stripe integration maps
 * 1:1, but the transition *rules* here are AFLO's own deterministic logic —
 * Stripe executes charges; AFLO decides state and entitlement. Nothing in
 * this package touches credit-readiness (charter: billing entitlement and
 * readiness must not be entangled).
 */

export type InvoiceStatus = "draft" | "open" | "paid" | "void" | "uncollectible";

export type SubscriptionStatus =
  | "trialing"
  | "active"
  | "past_due"
  | "paused"
  | "canceled";

export type PaymentStatus =
  | "requires_payment_method"
  | "processing"
  | "succeeded"
  | "failed"
  | "canceled";

export const INVOICE_STATUSES: readonly InvoiceStatus[] = [
  "draft",
  "open",
  "paid",
  "void",
  "uncollectible",
] as const;

export const SUBSCRIPTION_STATUSES: readonly SubscriptionStatus[] = [
  "trialing",
  "active",
  "past_due",
  "paused",
  "canceled",
] as const;

export const PAYMENT_STATUSES: readonly PaymentStatus[] = [
  "requires_payment_method",
  "processing",
  "succeeded",
  "failed",
  "canceled",
] as const;
