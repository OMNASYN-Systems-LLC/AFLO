import type { ActionStatus, AgentName, LifecycleStage, PipelineStatus, StaffMember } from "@aflo/shared";

/**
 * Fixed-locale, fixed-timezone formatters so server and client render
 * identically (the demo clock is pinned to SYNTHETIC_NOW).
 *
 * Labels for shared domain enums that the data layer also renders live in
 * @aflo/shared (ENGAGEMENT_STATUS_LABELS, REASON_CODE_DESCRIPTIONS) and are
 * re-exported here; labels used only by badges are colocated with them.
 */

export {
  ENGAGEMENT_STATUS_LABELS as ENGAGEMENT_LABELS,
  REASON_CODE_DESCRIPTIONS as REASON_CODE_LABELS,
} from "@aflo/shared";

const DATE_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  day: "numeric",
  year: "numeric",
});

const DATETIME_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const MONTH_FMT = new Intl.DateTimeFormat("en-US", {
  timeZone: "UTC",
  month: "short",
  year: "numeric",
});

export function fmtDate(iso: string): string {
  return DATE_FMT.format(new Date(iso));
}

export function fmtDateTime(iso: string): string {
  return DATETIME_FMT.format(new Date(iso));
}

/** "2026-09" → "Sep 2026" */
export function fmtMonth(month: string): string {
  return MONTH_FMT.format(new Date(`${month}-15T00:00:00Z`));
}

export function fmtMoney(cents: number): string {
  return (cents / 100).toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0,
  });
}

export function fmtPct(value: number, digits = 0): string {
  return `${value.toFixed(digits)}%`;
}

/** "Danielle Mercer" → "DM" */
export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("");
}

export const STAGE_LABELS: Record<LifecycleStage, string> = {
  recovery: "Recovery",
  stabilization: "Stabilization",
  credit_readiness: "Credit Readiness",
  capital_readiness: "Capital Readiness",
  acquisition: "Acquisition",
  maintenance: "Maintenance",
  growth: "Growth",
  legacy: "Legacy",
};

export const PIPELINE_LABELS: Record<PipelineStatus, string> = {
  new_lead: "New lead",
  contacted: "Contacted",
  consult_scheduled: "Consult scheduled",
  onboarding: "Onboarding",
  active: "Active",
  paused: "Paused",
};

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const STAFF_ROLE_LABELS: Record<StaffMember["role"], string> = {
  organization_owner: "Organization Owner",
  organization_admin: "Organization Admin",
  staff: "Advisor/Staff",
};

export const AGENT_LABELS: Record<AgentName, string> = {
  "intake-completeness-agent": "Intake Completeness Agent",
  "credit-profile-agent": "Credit Profile Agent",
  "utilization-agent": "Utilization Agent",
  "payment-history-agent": "Payment History Agent",
  "debt-obligation-agent": "Debt & Obligation Agent",
  "readiness-stage-agent": "Readiness Stage Agent",
  "roadmap-agent": "Roadmap Agent",
  "education-agent": "Education Agent",
  "engagement-agent": "Engagement Agent",
  "report-agent": "Report Agent",
  "partner-routing-agent": "Partner Routing Agent",
  "compliance-guard-agent": "Compliance Guard Agent",
};
