import { hasActiveConsent, type ConsentRecord } from "./consent";
import {
  isExternalChannel,
  NOTIFICATION_DEFAULT_CHANNELS,
  type NotificationChannel,
} from "./channels";
import type { NotificationType } from "./templates";

/**
 * User-controlled notification preferences (notification.v1.0.0).
 *
 * Preferences are granular (per notification type × channel), revocable, and
 * append-only (a change writes a newer record; latest-wins), exactly like
 * consent. They are ENFORCED BEFORE SEND: `resolveDelivery` decides, per
 * channel, whether a notification may go out — a channel the user disabled,
 * or an external channel without communication consent, is withheld with a
 * reason and never delivered.
 */

export interface NotificationPreferenceRecord {
  /** Recipient identity (client id in the prototype; user id with real auth). */
  userId: string;
  notificationType: NotificationType;
  channel: NotificationChannel;
  enabled: boolean;
  recordedAt: string; // ISO datetime — latest record for a (user, type, channel) wins
}

/**
 * Is a channel enabled for a (user, type)? The latest matching preference
 * record wins; with no record, the type's default routing decides. Rejects
 * unparseable timestamps (fail closed).
 */
export function isChannelEnabled(
  records: readonly NotificationPreferenceRecord[],
  userId: string,
  type: NotificationType,
  channel: NotificationChannel,
): boolean {
  let latest: NotificationPreferenceRecord | null = null;
  let latestMs = -Infinity;
  for (const r of records) {
    if (r.userId !== userId || r.notificationType !== type || r.channel !== channel) continue;
    const ms = Date.parse(r.recordedAt);
    if (Number.isNaN(ms)) throw new TypeError(`preference record has an invalid timestamp: ${r.recordedAt}`);
    if (ms >= latestMs) {
      latestMs = ms;
      latest = r;
    }
  }
  if (latest) return latest.enabled;
  return NOTIFICATION_DEFAULT_CHANNELS[type].includes(channel);
}

export type ChannelSuppressionReason = "CHANNEL_DISABLED" | "NO_COMMUNICATION_CONSENT";

export interface ChannelDelivery {
  channel: NotificationChannel;
  willSend: boolean;
  reason: ChannelSuppressionReason | null;
}

/**
 * Resolve, per default channel of the type, whether it will be delivered.
 * A disabled channel is withheld (CHANNEL_DISABLED); an external channel
 * without active communication consent is withheld (NO_COMMUNICATION_CONSENT).
 * In-app requires no external consent. The full set is returned (including
 * withheld channels) so suppression is recorded, never silent.
 */
export function resolveDelivery(
  type: NotificationType,
  userId: string,
  preferences: readonly NotificationPreferenceRecord[],
  consentRecords: readonly ConsentRecord[],
): ChannelDelivery[] {
  return NOTIFICATION_DEFAULT_CHANNELS[type].map((channel) => {
    if (!isChannelEnabled(preferences, userId, type, channel)) {
      return { channel, willSend: false, reason: "CHANNEL_DISABLED" };
    }
    if (isExternalChannel(channel) && !hasActiveConsent(consentRecords, userId, "communication")) {
      return { channel, willSend: false, reason: "NO_COMMUNICATION_CONSENT" };
    }
    return { channel, willSend: true, reason: null };
  });
}
