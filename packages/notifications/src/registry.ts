import { DELIVERY_STATUSES } from "./delivery";
import { NOTIFICATION_RULES_VERSION, NOTIFICATION_TYPES } from "./templates";

/**
 * Notification-rules metadata, shaped like the deterministic rule registries
 * in @aflo/rules and @aflo/billing so the delivery workflow's version,
 * inputs, and reason codes are documented and lockstep-tested.
 */
export interface NotificationRuleDefinition {
  id: string;
  version: string;
  effectiveDate: string;
  description: string;
  inputs: string[];
  output: string;
  reasonCodes: string[];
  changeHistory: { version: string; date: string; note: string }[];
}

export const NOTIFICATION_RULE: NotificationRuleDefinition = {
  id: "notification.delivery",
  version: NOTIFICATION_RULES_VERSION,
  effectiveDate: "2026-07-18",
  description:
    "Consent-gated notification delivery: a communication is planned only with active 'communication' consent (append-only, latest-record-wins), rendered from a typed template that fails closed on missing variables, and tracked through an allow-list delivery state machine (queued → sent → delivered | bounced, failed → retry; suppressed/delivered/bounced terminal). Dev/preview deliver via the mock provider; Resend activates on founder credentials.",
  inputs: ["notificationType", "recipientUserId", "templateVars", "consentRecords", "deliveryStatus transitions"],
  output: "PlannedNotification { status, suppressionReason, message } / DeliveryTransitionResult",
  reasonCodes: [
    "NO_COMMUNICATION_CONSENT",
    "DL_SENT",
    "DL_DELIVERED",
    "DL_BOUNCED",
    "DL_FAILED",
    "DL_RETRIED",
    "DL_SAME_STATUS",
    "DL_UNKNOWN_STATUS",
    "DL_ILLEGAL_TRANSITION",
  ],
  changeHistory: [
    { version: "notification.v1.0.0", date: "2026-07-18", note: "Initial consent-gated delivery kernel (founder workstream slice L)." },
  ],
};

/** Counts kept here so a template/status addition trips the lockstep test. */
export const NOTIFICATION_TYPE_COUNT = NOTIFICATION_TYPES.length;
export const DELIVERY_STATUS_COUNT = DELIVERY_STATUSES.length;
