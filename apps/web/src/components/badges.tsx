import type {
  ClientKind,
  ClientStatus,
  DocumentReviewStatus,
  EngagementStatus,
  IntakeStatus,
  LifecycleStage,
  ReportStatus,
  ReviewStatus,
} from "@aflo/shared";
import { CLIENT_STATUS_LABELS, ENGAGEMENT_LABELS, STAGE_LABELS } from "@/lib/format";

/**
 * Status is never color alone: every badge carries its text label, and tones
 * come from the validated status palette in globals.css. Badge-only enums
 * colocate {label, tone} here; shared-domain labels come from @aflo/shared
 * via lib/format.
 */

type Tone = "good" | "warn" | "risk" | "calm" | "neutral" | "emerald" | "gold";

const TONES: Record<Tone, { chip: string; dot: string }> = {
  good: { chip: "bg-status-good-tint text-emerald-deep", dot: "bg-status-good" },
  warn: { chip: "bg-status-warn-tint text-gold-deep", dot: "bg-status-warn" },
  risk: { chip: "bg-status-risk-tint text-status-risk", dot: "bg-status-risk" },
  calm: { chip: "bg-status-calm-tint text-status-calm", dot: "bg-status-calm" },
  neutral: { chip: "bg-neutral-tint text-ink-soft", dot: "bg-ink-faint" },
  emerald: { chip: "border border-emerald/30 text-emerald-deep", dot: "bg-emerald" },
  gold: { chip: "border border-gold/40 text-gold-deep", dot: "bg-gold" },
};

export function Badge({ tone, label }: { tone: Tone; label: string }) {
  const t = TONES[tone];
  return (
    <span
      className={`inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${t.chip}`}
    >
      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${t.dot}`} />
      {label}
    </span>
  );
}

const ENGAGEMENT_TONES: Record<EngagementStatus, Tone> = {
  active: "good",
  cooling: "warn",
  at_risk: "risk",
  dormant: "calm",
};

export function EngagementBadge({ status }: { status: EngagementStatus }) {
  return <Badge tone={ENGAGEMENT_TONES[status]} label={ENGAGEMENT_LABELS[status]} />;
}

export function StageBadge({ stage }: { stage: LifecycleStage | null }) {
  if (!stage) return <Badge tone="neutral" label="Pre-assessment" />;
  return <Badge tone="emerald" label={STAGE_LABELS[stage]} />;
}

export function KindBadge({ kind }: { kind: ClientKind }) {
  return kind === "client" ? (
    <Badge tone="emerald" label="Client" />
  ) : (
    <Badge tone="gold" label="Lead" />
  );
}

/** Pipeline stage label comes from the org's configurable definition. */
export function PipelineBadge({ label }: { label: string }) {
  return <Badge tone="neutral" label={label} />;
}

export function ClientStatusBadge({ status }: { status: ClientStatus }) {
  return (
    <Badge tone={status === "active" ? "good" : "calm"} label={CLIENT_STATUS_LABELS[status]} />
  );
}

const INTAKE_STATUS: Record<IntakeStatus, { label: string; tone: Tone }> = {
  in_progress: { label: "Intake in progress", tone: "warn" },
  completed: { label: "Intake complete", tone: "good" },
};

export function IntakeStatusBadge({ status }: { status: IntakeStatus }) {
  const s = INTAKE_STATUS[status];
  return <Badge tone={s.tone} label={s.label} />;
}

const DOC_STATUS: Record<DocumentReviewStatus, { label: string; tone: Tone }> = {
  requested: { label: "Requested", tone: "neutral" },
  uploaded: { label: "Uploaded", tone: "calm" },
  in_review: { label: "In review", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  needs_attention: { label: "Needs attention", tone: "risk" },
};

export function DocStatusBadge({ status }: { status: DocumentReviewStatus }) {
  const s = DOC_STATUS[status];
  return <Badge tone={s.tone} label={s.label} />;
}

const REPORT_STATUS: Record<ReportStatus, { label: string; tone: Tone }> = {
  draft: { label: "Draft", tone: "neutral" },
  ready_for_review: { label: "Ready for review", tone: "warn" },
  published: { label: "Published", tone: "good" },
};

export function ReportStatusBadge({ status }: { status: ReportStatus }) {
  const s = REPORT_STATUS[status];
  return <Badge tone={s.tone} label={s.label} />;
}

const REVIEW_STATUS: Record<ReviewStatus, { label: string; tone: Tone }> = {
  pending_review: { label: "Pending review", tone: "warn" },
  approved: { label: "Approved", tone: "good" },
  rejected: { label: "Rejected", tone: "risk" },
  auto_published: { label: "Auto-published", tone: "calm" },
};

export function ReviewStatusBadge({ status }: { status: ReviewStatus }) {
  const s = REVIEW_STATUS[status];
  return <Badge tone={s.tone} label={s.label} />;
}
