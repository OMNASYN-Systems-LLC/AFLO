import type { ConsentType } from "./consent";

/**
 * Notification template registry (notification.v1.0.0).
 *
 * Each notification type binds to a channel, the consent type it requires,
 * and a deterministic renderer over typed variables. Rendering fails closed
 * on any missing/blank variable so a half-populated message is never sent.
 * Templates carry no client PII beyond what the caller passes as variables.
 */

export const NOTIFICATION_RULES_VERSION = "notification.v1.0.0";

export type NotificationChannel = "email";

/**
 * Notification types, each triggered by a domain event. Client-facing
 * communications all require `communication` consent.
 */
export const NOTIFICATION_TYPES = [
  "appointment_scheduled",
  "roadmap_published",
  "report_published",
  "document_requested",
  "task_assigned",
] as const;

export type NotificationType = (typeof NOTIFICATION_TYPES)[number];

/** Typed variables per notification type. */
export interface NotificationVarsMap {
  appointment_scheduled: { firstName: string; when: string; advisorName: string };
  roadmap_published: { firstName: string; roadmapTitle: string };
  report_published: { firstName: string; quarter: string };
  document_requested: { firstName: string; documentName: string };
  task_assigned: { firstName: string; taskTitle: string; dueDate: string };
}

export interface RenderedMessage {
  channel: NotificationChannel;
  subject: string;
  body: string;
}

export interface NotificationTemplate<T extends NotificationType> {
  type: T;
  channel: NotificationChannel;
  requiresConsent: ConsentType;
  render: (vars: NotificationVarsMap[T]) => RenderedMessage;
}

/** Throws if any variable is missing or blank — a message is all-or-nothing. */
function requireVars<T extends Record<string, string>>(vars: T, keys: (keyof T)[]): void {
  for (const key of keys) {
    const value = vars[key];
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`notification template variable "${String(key)}" is required`);
    }
  }
}

const TEMPLATES: { [T in NotificationType]: NotificationTemplate<T> } = {
  appointment_scheduled: {
    type: "appointment_scheduled",
    channel: "email",
    requiresConsent: "communication",
    render: (v) => {
      requireVars(v, ["firstName", "when", "advisorName"]);
      return {
        channel: "email",
        subject: "Your appointment is confirmed",
        body: `Hi ${v.firstName}, your appointment with ${v.advisorName} is confirmed for ${v.when}. Reply to this email if you need to reschedule.`,
      };
    },
  },
  roadmap_published: {
    type: "roadmap_published",
    channel: "email",
    requiresConsent: "communication",
    render: (v) => {
      requireVars(v, ["firstName", "roadmapTitle"]);
      return {
        channel: "email",
        subject: "Your roadmap is ready",
        body: `Hi ${v.firstName}, your advisor has published your roadmap "${v.roadmapTitle}". Sign in to your portal to review the milestones ahead.`,
      };
    },
  },
  report_published: {
    type: "report_published",
    channel: "email",
    requiresConsent: "communication",
    render: (v) => {
      requireVars(v, ["firstName", "quarter"]);
      return {
        channel: "email",
        subject: `Your ${v.quarter} progress report is available`,
        body: `Hi ${v.firstName}, your ${v.quarter} progress report has been published. Sign in to your portal to see how far you've come and what's next.`,
      };
    },
  },
  document_requested: {
    type: "document_requested",
    channel: "email",
    requiresConsent: "communication",
    render: (v) => {
      requireVars(v, ["firstName", "documentName"]);
      return {
        channel: "email",
        subject: "Action needed: a document was requested",
        body: `Hi ${v.firstName}, your advisor requested "${v.documentName}". Please upload it through your portal when you have a moment.`,
      };
    },
  },
  task_assigned: {
    type: "task_assigned",
    channel: "email",
    requiresConsent: "communication",
    render: (v) => {
      requireVars(v, ["firstName", "taskTitle", "dueDate"]);
      return {
        channel: "email",
        subject: "A new action is in your plan",
        body: `Hi ${v.firstName}, a new action was added to your plan: "${v.taskTitle}" (due ${v.dueDate}). Sign in to your portal for details.`,
      };
    },
  },
};

export function getTemplate<T extends NotificationType>(type: T): NotificationTemplate<T> {
  return TEMPLATES[type];
}

export function renderNotification<T extends NotificationType>(
  type: T,
  vars: NotificationVarsMap[T],
): RenderedMessage {
  return TEMPLATES[type].render(vars);
}

// Exhaustiveness: every NotificationType must have a template. A missing or
// extra key stops compilation. Tuple-wrapped to avoid distributive pitfalls.
type _AssertCovers = [NotificationType] extends [keyof typeof TEMPLATES] ? true : never;
const _covers: _AssertCovers = true;
void _covers;
