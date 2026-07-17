/**
 * Registry of scheduled jobs the Railway worker will own.
 *
 * V1 slice: definitions only — no scheduler, no external calls, no database.
 * Each job will later consume the outbox table (see
 * docs/architecture/INITIAL_ARCHITECTURE.md, "Event Model") idempotently.
 */

export interface JobDefinition {
  name: string;
  /** Human-readable cadence; a real scheduler replaces this later. */
  cadence: string;
  description: string;
}

export const JOB_REGISTRY: JobDefinition[] = [
  {
    name: "appointment-reminders",
    cadence: "hourly",
    description: "Send reminder emails for appointments in the next 24 hours (Resend).",
  },
  {
    name: "engagement-scan",
    cadence: "daily",
    description:
      "Run versioned engagement rules over client activity and queue at-risk follow-up recommendations for staff review.",
  },
  {
    name: "monthly-action-rollover",
    cadence: "monthly",
    description: "Open next month's action plans from approved roadmap milestones.",
  },
  {
    name: "quarterly-report-drafts",
    cadence: "quarterly",
    description:
      "Draft quarterly progress reports (report-agent) and mark them ready_for_review — never auto-published.",
  },
  {
    name: "outbox-dispatch",
    cadence: "every minute",
    description: "Poll the transactional outbox and dispatch pending events idempotently.",
  },
];
