import type {
  ActionStatus,
  AgentName,
  DocumentReviewStatus,
  EngagementStatus,
  LifecycleStage,
  PipelineStatus,
  ReportStatus,
  ReviewStatus,
} from "@aflo/shared";

/**
 * Fixed-locale, fixed-timezone formatters so server and client render
 * identically (the demo clock is pinned to SYNTHETIC_NOW).
 */

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

export const ENGAGEMENT_LABELS: Record<EngagementStatus, string> = {
  active: "Engaged",
  cooling: "Cooling",
  at_risk: "At risk",
  dormant: "Dormant",
};

export const DOC_STATUS_LABELS: Record<DocumentReviewStatus, string> = {
  requested: "Requested",
  uploaded: "Uploaded",
  in_review: "In review",
  approved: "Approved",
  needs_attention: "Needs attention",
};

export const REPORT_STATUS_LABELS: Record<ReportStatus, string> = {
  draft: "Draft",
  ready_for_review: "Ready for review",
  published: "Published",
};

export const REVIEW_STATUS_LABELS: Record<ReviewStatus, string> = {
  pending_review: "Pending review",
  approved: "Approved",
  rejected: "Rejected",
  auto_published: "Auto-published",
};

export const ACTION_STATUS_LABELS: Record<ActionStatus, string> = {
  todo: "To do",
  in_progress: "In progress",
  done: "Done",
};

export const AGENT_LABELS: Record<AgentName, string> = {
  "credit-profile-agent": "Credit Profile Agent",
  "utilization-agent": "Utilization Agent",
  "payment-history-agent": "Payment History Agent",
  "readiness-agent": "Readiness Agent",
  "roadmap-agent": "Roadmap Agent",
  "education-agent": "Education Agent",
  "engagement-agent": "Engagement Agent",
  "report-agent": "Report Agent",
};

/** Human explanations for deterministic reason codes (rule readiness.v1.0.0). */
export const REASON_CODE_LABELS: Record<string, string> = {
  RC_INCOME_UNSTABLE: "Income is currently unstable",
  RC_PAYMENT_HISTORY_POOR: "On-time payment rate below 85%",
  RC_DEROGATORY_HIGH: "More than 3 derogatory marks",
  RC_DTI_HIGH: "Debt-to-income above 45%",
  RC_RESERVES_LOW: "Less than 1 month of reserves",
  RC_SCORE_BELOW_CREDIT_FLOOR: "Score below the 640 floor",
  RC_UTILIZATION_ABOVE_30: "Utilization above 30%",
  RC_SCORE_BELOW_CAPITAL_FLOOR: "Score below the 680 capital floor",
  RC_UTILIZATION_ABOVE_10: "Utilization above 10%",
  RC_RESERVES_BELOW_3M: "Less than 3 months of reserves",
  RC_DTI_ABOVE_36: "Debt-to-income above 36%",
  RC_ALL_ACQUISITION_GATES_MET: "All acquisition gates met",
  RC_SCORE_MISSING: "No credit score on file",
};
