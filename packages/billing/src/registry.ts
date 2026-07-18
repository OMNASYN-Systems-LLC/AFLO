import { BILLING_RULES_VERSION } from "./transitions";

/**
 * Billing rule metadata registry — the charter's per-rule contract (stable
 * id, version, effective date, inputs/output, reason codes, change history),
 * kept separate from the credit-readiness registry so billing entitlement
 * never entangles with readiness.
 */

export interface BillingRuleChangeEntry {
  version: string;
  date: string;
  note: string;
}

export interface BillingRuleDefinition {
  id: string;
  version: string;
  effectiveDate: string;
  description: string;
  inputs: string[];
  output: string;
  reasonCodes: string[];
  changeHistory: BillingRuleChangeEntry[];
}

export const BILLING_RULE_REGISTRY: readonly BillingRuleDefinition[] = [
  {
    id: "billing.invoice_transition",
    version: BILLING_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Allow-list state machine for invoice status: draft → open → {paid|void|uncollectible}; uncollectible → paid for late settlement.",
    inputs: ["from:InvoiceStatus", "to:InvoiceStatus"],
    output: "TransitionResult { allowed, reasonCode }",
    reasonCodes: ["BR_OK", "BR_ILLEGAL_TRANSITION", "BR_TERMINAL_STATE", "BR_SAME_STATE"],
    changeHistory: [
      { version: "billing.v1.0.0", date: "2026-07-18", note: "Initial invoice state machine." },
    ],
  },
  {
    id: "billing.subscription_transition",
    version: BILLING_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Allow-list state machine for subscription status: trialing → active; active ↔ past_due, active ↔ paused; any non-terminal → canceled.",
    inputs: ["from:SubscriptionStatus", "to:SubscriptionStatus"],
    output: "TransitionResult { allowed, reasonCode }",
    reasonCodes: ["BR_OK", "BR_ILLEGAL_TRANSITION", "BR_TERMINAL_STATE", "BR_SAME_STATE"],
    changeHistory: [
      { version: "billing.v1.0.0", date: "2026-07-18", note: "Initial subscription state machine." },
    ],
  },
  {
    id: "billing.payment_transition",
    version: BILLING_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Allow-list state machine for payment status: requires_payment_method → processing → {succeeded|failed}; failed is retriable.",
    inputs: ["from:PaymentStatus", "to:PaymentStatus"],
    output: "TransitionResult { allowed, reasonCode }",
    reasonCodes: ["BR_OK", "BR_ILLEGAL_TRANSITION", "BR_TERMINAL_STATE", "BR_SAME_STATE"],
    changeHistory: [
      { version: "billing.v1.0.0", date: "2026-07-18", note: "Initial payment state machine." },
    ],
  },
  {
    id: "billing.subscription_entitlement",
    version: BILLING_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Subscription-access gate: active/trialing entitled; past_due entitled within a grace window then withdrawn; paused/canceled not entitled. Independent of credit-readiness.",
    inputs: ["status", "pastDueSinceIso?", "now", "graceDays?"],
    output: "EntitlementDecision { entitled, reasonCode }",
    reasonCodes: [
      "ENT_ACTIVE",
      "ENT_TRIALING",
      "ENT_PAST_DUE_IN_GRACE",
      "ENT_PAST_DUE_EXPIRED",
      "ENT_PAUSED",
      "ENT_CANCELED",
    ],
    changeHistory: [
      { version: "billing.v1.0.0", date: "2026-07-18", note: "Initial entitlement gate with 7-day past-due grace." },
    ],
  },
  {
    id: "billing.invoice_past_due",
    version: BILLING_RULES_VERSION,
    effectiveDate: "2026-07-18",
    description:
      "Deterministic past-due check for an open invoice from its due date and the current time (with optional grace days). Never a stored status.",
    inputs: ["status", "dueDateIso", "now", "graceDays?"],
    output: "boolean",
    reasonCodes: [],
    changeHistory: [
      { version: "billing.v1.0.0", date: "2026-07-18", note: "Initial past-due calculator." },
    ],
  },
] as const;

export function getBillingRule(id: string): BillingRuleDefinition | undefined {
  return BILLING_RULE_REGISTRY.find((r) => r.id === id);
}
