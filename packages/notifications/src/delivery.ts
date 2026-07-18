import { NOTIFICATION_RULES_VERSION } from "./templates";

/**
 * Deterministic delivery-log state machine (notification.v1.0.0).
 *
 * A notification is either suppressed at plan time (consent gate) or queued.
 * Once queued it moves through the provider lifecycle. `suppressed`,
 * `delivered`, and `bounced` are terminal; `failed` may be retried back to
 * `queued`. Anything unlisted is denied with a reason code — delivery state
 * is auditable and never invented.
 */

export const DELIVERY_STATUSES = [
  "suppressed",
  "queued",
  "sent",
  "delivered",
  "bounced",
  "failed",
] as const;

export type DeliveryStatus = (typeof DELIVERY_STATUSES)[number];

export type DeliveryReasonCode =
  | "DL_SENT"
  | "DL_DELIVERED"
  | "DL_BOUNCED"
  | "DL_FAILED"
  | "DL_RETRIED"
  | "DL_SAME_STATUS"
  | "DL_UNKNOWN_STATUS"
  | "DL_ILLEGAL_TRANSITION";

const ALLOWED: Record<DeliveryStatus, Partial<Record<DeliveryStatus, DeliveryReasonCode>>> = {
  suppressed: {},
  queued: { sent: "DL_SENT", failed: "DL_FAILED" },
  sent: { delivered: "DL_DELIVERED", bounced: "DL_BOUNCED" },
  failed: { queued: "DL_RETRIED" },
  delivered: {},
  bounced: {},
};

export interface DeliveryTransitionResult {
  allowed: boolean;
  fromStatus: string;
  toStatus: string;
  reasonCode: DeliveryReasonCode;
  ruleVersion: string;
}

export function deliveryTransition(fromStatus: string, toStatus: string): DeliveryTransitionResult {
  const base = { fromStatus, toStatus, ruleVersion: NOTIFICATION_RULES_VERSION };
  const known = (s: string): s is DeliveryStatus => (DELIVERY_STATUSES as readonly string[]).includes(s);
  if (!known(fromStatus) || !known(toStatus)) {
    return { ...base, allowed: false, reasonCode: "DL_UNKNOWN_STATUS" };
  }
  if (fromStatus === toStatus) return { ...base, allowed: false, reasonCode: "DL_SAME_STATUS" };
  const code = ALLOWED[fromStatus][toStatus];
  if (!code) return { ...base, allowed: false, reasonCode: "DL_ILLEGAL_TRANSITION" };
  return { ...base, allowed: true, reasonCode: code };
}
