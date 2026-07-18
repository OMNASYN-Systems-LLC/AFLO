# @aflo/billing

Deterministic billing kernel for AFLO — pure, versioned, tested state logic with **no Stripe dependency and no credit-readiness coupling** (charter: billing entitlement must not entangle with readiness calculations).

## What lives here

| Module | Responsibility |
|---|---|
| `status.ts` | The status vocabularies (`InvoiceStatus`, `SubscriptionStatus`, `PaymentStatus`), named to mirror Stripe so the integration maps 1:1. |
| `transitions.ts` | Allow-list state machines (`invoiceTransition`, `subscriptionTransition`, `paymentTransition`) returning a typed `TransitionResult` with a reason code; plus `isInvoicePastDue` (a deterministic function of due date + now, never a stored status). |
| `entitlement.ts` | `evaluateEntitlement` — the subscription-access gate: active/trialing entitled, `past_due` entitled within a grace window then withdrawn, paused/canceled not. |
| `registry.ts` | The billing rule metadata registry (stable id, version, effective date, inputs/output, reason codes, change history) — the charter's per-rule contract, kept separate from the readiness registry. |

Rules version: `billing.v1.0.0`. Every transition and decision is tagged with it.

## What is deliberately **not** here

- **Stripe calls, credentials, or webhooks.** Stripe executes charges and is the system of record for payment instruments; this kernel only decides internal state and entitlement. The Stripe integration (a later slice) consumes these functions and never bypasses them.
- **Persistence / entities.** The billing tables (`service_packages`, `organization_service_packages`, `billing_customers`, `subscriptions`, `invoices`, `invoice_line_items`, `payment_records`, `webhook_events`, `billing_events`, `refund_requests`, `billing_preferences`) and their DDL land with the persistence slice in `docs/architecture/DATABASE_SCHEMA.md` and `packages/database`. AFLO stores only Stripe ids, status, amount, currency, timestamps, and an internal service-package reference — never raw card numbers, CVVs, full bank-account numbers, or payment credentials.
- **Real-money movement.** Out of scope for V1 beyond Stripe payment processing.

## Usage

```ts
import { subscriptionTransition, evaluateEntitlement } from "@aflo/billing";

const move = subscriptionTransition("active", "past_due"); // { allowed: true, reasonCode: "BR_OK", ... }
const access = evaluateEntitlement({ status: "past_due", pastDueSinceIso, now }); // grace-aware
```

Illegal transitions are rejected with a reason code the service layer records in `billing_events` — never silently dropped.
