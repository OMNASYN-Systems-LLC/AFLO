import { hasActiveConsent, type ConsentRecord } from "./consent";
import {
  getTemplate,
  renderNotification,
  type NotificationType,
  type NotificationVarsMap,
  type RenderedMessage,
} from "./templates";

/**
 * Plan a notification: the consent gate runs before any content is rendered
 * or dispatched. A planned notification is either `suppressed` (no send, with
 * a reason) or `queued` (ready to hand to a provider). Pure and deterministic
 * — no side effects, no I/O.
 */

export type SuppressionReason = "NO_COMMUNICATION_CONSENT";

export interface PlannedNotification<T extends NotificationType> {
  type: T;
  recipientUserId: string;
  status: "suppressed" | "queued";
  suppressionReason: SuppressionReason | null;
  /** Rendered content — present only when queued. */
  message: RenderedMessage | null;
}

export interface PlanNotificationInput<T extends NotificationType> {
  type: T;
  recipientUserId: string;
  vars: NotificationVarsMap[T];
  consentRecords: readonly ConsentRecord[];
}

export function planNotification<T extends NotificationType>(
  input: PlanNotificationInput<T>,
): PlannedNotification<T> {
  const template = getTemplate(input.type);
  const consented = hasActiveConsent(input.consentRecords, input.recipientUserId, template.requiresConsent);
  if (!consented) {
    return {
      type: input.type,
      recipientUserId: input.recipientUserId,
      status: "suppressed",
      suppressionReason: "NO_COMMUNICATION_CONSENT",
      message: null,
    };
  }
  return {
    type: input.type,
    recipientUserId: input.recipientUserId,
    status: "queued",
    suppressionReason: null,
    message: renderNotification(input.type, input.vars),
  };
}
