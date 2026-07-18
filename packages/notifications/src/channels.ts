import type { NotificationType } from "./templates";

/**
 * Delivery channels and per-type default routing (notification.v1.0.0).
 *
 * Channels: in-app, email, SMS. Push is deferred until native adoption
 * justifies it (charter). `in_app` is delivered inside the authenticated
 * portal, so it never requires external communication consent; `email` and
 * `sms` are external channels and do (see preferences.resolveDelivery).
 *
 * The default channels per type follow the founder's category→channel
 * mapping: in-app for everything, email for anything durable, and SMS only
 * for genuinely time-sensitive prompts (appointments).
 */

export const NOTIFICATION_CHANNELS = ["in_app", "email", "sms"] as const;

export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number];

/** External channels carry content off-platform and require consent. */
export function isExternalChannel(channel: NotificationChannel): boolean {
  return channel === "email" || channel === "sms";
}

export const NOTIFICATION_DEFAULT_CHANNELS: Record<NotificationType, NotificationChannel[]> = {
  appointment_scheduled: ["in_app", "email", "sms"],
  roadmap_published: ["in_app", "email"],
  report_published: ["in_app", "email"],
  document_requested: ["in_app", "email"],
  task_assigned: ["in_app"],
};

// Exhaustiveness: a new NotificationType without a default channel set stops
// compilation. Tuple-wrapped to avoid distributive-conditional pitfalls.
type _AssertCovers = [NotificationType] extends [keyof typeof NOTIFICATION_DEFAULT_CHANNELS]
  ? true
  : never;
const _covers: _AssertCovers = true;
void _covers;
