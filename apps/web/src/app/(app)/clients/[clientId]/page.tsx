import { fullName, LIFECYCLE_STAGES } from "@aflo/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentSuggestionCard } from "@/components/agent-card";
import {
  DocStatusBadge,
  EngagementBadge,
  KindBadge,
  PipelineBadge,
  ReportStatusBadge,
  StageBadge,
} from "@/components/badges";
import { StageTrack } from "@/components/stage";
import { EmptyState, ProgressBar, SectionCard } from "@/components/ui";
import { DEMO_ORG_ID, clientRepository, demoNow } from "@/lib/data";
import {
  ACTION_STATUS_LABELS,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtMonth,
  fmtPct,
  REASON_CODE_LABELS,
  STAGE_LABELS,
} from "@/lib/format";

export const metadata = { title: "Client detail" };

export default async function ClientDetailPage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await clientRepository.getDetail(DEMO_ORG_ID, clientId, demoNow);
  if (!detail) notFound();

  const { record, assessment, engagement } = detail;
  const name = fullName(record);
  const primaryGoal = detail.goals.find((g) => g.isPrimary) ?? null;
  const otherGoals = detail.goals.filter((g) => !g.isPrimary);
  const milestonesDone = detail.milestones.filter((m) => m.status === "completed").length;
  const pendingAi = detail.aiSuggestions.filter((s) => s.reviewStatus === "pending_review");

  return (
    <div className="space-y-6">
      <Link href="/clients" className="text-xs font-medium text-ink-soft hover:text-emerald">
        ← Leads &amp; Clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink">{name}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <KindBadge kind={record.kind} />
            <PipelineBadge status={record.pipelineStatus} />
            <EngagementBadge status={engagement.status} />
            <span className="text-xs text-ink-faint">
              {engagement.daysSinceLastActivity}{" "}
              {engagement.daysSinceLastActivity === 1 ? "day" : "days"} since last activity
            </span>
          </div>
        </div>
        <div className="rounded-lg border border-line bg-card px-5 py-3.5 text-right">
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
            Next appointment
          </p>
          {detail.nextAppointment ? (
            <>
              <p className="mt-1 text-sm font-medium text-ink">
                {fmtDateTime(detail.nextAppointment.appointment.scheduledAt)}
              </p>
              <p className="mt-0.5 text-xs text-ink-soft">
                {detail.nextAppointment.appointment.purpose} · {detail.nextAppointment.staffName}
              </p>
            </>
          ) : (
            <p className="mt-1 text-sm text-ink-faint">None scheduled</p>
          )}
        </div>
      </div>

      {pendingAi.length > 0 ? (
        <p className="rounded-md border border-gold/50 bg-status-warn-tint px-4 py-2.5 text-sm text-gold-deep">
          {pendingAi.length} AI draft{pendingAi.length > 1 ? "s" : ""} awaiting staff review below —
          drafts never change client facts.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        {/* Main column */}
        <div className="space-y-6 xl:col-span-2">
          <SectionCard
            title="Readiness stage"
            subtitle={
              assessment
                ? `Deterministic assessment · rule ${assessment.ruleVersion}`
                : "Awaiting completed intake"
            }
            action={<StageBadge stage={assessment?.stage ?? null} />}
          >
            {assessment && detail.derived && detail.creditProfile ? (
              <div className="space-y-5">
                <div>
                  <StageTrack current={assessment.stage} />
                  <p className="mt-2 text-xs text-ink-faint">
                    Stage {LIFECYCLE_STAGES.indexOf(assessment.stage) + 1} of{" "}
                    {LIFECYCLE_STAGES.length} —{" "}
                    <span className="font-medium text-ink-soft">{STAGE_LABELS[assessment.stage]}</span>
                  </p>
                </div>

                <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                  <MiniStat
                    label="Credit score"
                    value={detail.creditProfile.score !== null ? String(detail.creditProfile.score) : "—"}
                    hint={detail.creditProfile.scoreAsOf ? `as of ${fmtDate(detail.creditProfile.scoreAsOf)}` : "not on file"}
                  />
                  <MiniStat label="Utilization" value={fmtPct(detail.derived.utilizationPct, 1)} hint="revolving" />
                  <MiniStat label="DTI" value={fmtPct(detail.derived.dtiPct, 1)} hint="debt-to-income" />
                  <MiniStat
                    label="Reserves"
                    value={`${detail.derived.reserveMonths.toFixed(1)} mo`}
                    hint="of essentials"
                  />
                </div>

                <div>
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                    Why this stage
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {assessment.reasonCodes.map((code) => (
                      <li
                        key={code}
                        title={code}
                        className="rounded bg-sand px-2 py-1 text-xs text-ink-soft"
                      >
                        {REASON_CODE_LABELS[code]}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            ) : (
              <EmptyState
                message={`Assessment pending — ${[
                  !detail.financialProfile && "financial profile",
                  !detail.creditProfile && "credit profile",
                ]
                  .filter(Boolean)
                  .join(" and ")} not yet captured during intake.`}
              />
            )}
          </SectionCard>

          <SectionCard
            title="Roadmap"
            subtitle={`${milestonesDone} of ${detail.milestones.length} milestones complete`}
          >
            {detail.milestones.length === 0 ? (
              <EmptyState message="No roadmap yet — drafted after onboarding and staff approval." />
            ) : (
              <ol className="space-y-4">
                {detail.milestones.map((ms) => (
                  <li key={ms.id} className="flex gap-3.5">
                    <MilestoneMarker status={ms.status} />
                    <div className="min-w-0 flex-1 pb-1">
                      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                        <p
                          className={`text-sm font-medium ${
                            ms.status === "completed" ? "text-ink-faint line-through" : "text-ink"
                          }`}
                        >
                          {ms.title}
                        </p>
                        <p className="text-xs text-ink-faint">{fmtMonth(ms.targetMonth)}</p>
                      </div>
                      <p className="mt-0.5 text-xs leading-relaxed text-ink-soft">{ms.description}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>

          <SectionCard title="Monthly action plan" subtitle={fmtMonth(detail.actionPlanMonth)}>
            {detail.monthlyActions.length === 0 ? (
              <EmptyState message="No actions assigned this month." />
            ) : (
              <ul className="divide-y divide-line/60">
                {detail.monthlyActions.map((action) => (
                  <li key={action.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="flex min-w-0 items-center gap-3">
                      <ActionMarker done={action.status === "done"} inProgress={action.status === "in_progress"} />
                      <span
                        className={`truncate text-sm ${
                          action.status === "done" ? "text-ink-faint line-through" : "text-ink"
                        }`}
                      >
                        {action.title}
                      </span>
                    </div>
                    <div className="flex shrink-0 items-center gap-3 text-xs text-ink-faint">
                      <span className="rounded bg-sand px-1.5 py-0.5 capitalize">{action.category}</span>
                      <span>{ACTION_STATUS_LABELS[action.status]}</span>
                      <span>due {fmtDate(action.dueDate)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="AI drafts &amp; recommendations"
            subtitle="Proposals only — staff approve before anything reaches the client"
          >
            {detail.aiSuggestions.length === 0 ? (
              <EmptyState message="No AI drafts for this client." />
            ) : (
              <div className="space-y-4">
                {detail.aiSuggestions.map((s) => (
                  <AgentSuggestionCard key={s.id} envelope={s} />
                ))}
              </div>
            )}
          </SectionCard>
        </div>

        {/* Side column */}
        <div className="space-y-6">
          <SectionCard title="Current goal">
            {primaryGoal ? (
              <div>
                <p className="text-sm font-medium text-ink">{primaryGoal.title}</p>
                <p className="mt-1 text-xs text-ink-faint">
                  Target {fmtDate(primaryGoal.targetDate)}
                </p>
                <div className="mt-3">
                  <ProgressBar pct={primaryGoal.progressPct} />
                </div>
                {otherGoals.length > 0 ? (
                  <ul className="mt-4 space-y-1.5 border-t border-line/70 pt-3">
                    {otherGoals.map((g) => (
                      <li key={g.id} className="flex items-baseline justify-between gap-2 text-xs">
                        <span className="text-ink-soft">{g.title}</span>
                        <span className="tabular-nums text-ink-faint">{g.progressPct}%</span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No goal set yet." />
            )}
          </SectionCard>

          <SectionCard title="Documents">
            {detail.documents.length === 0 ? (
              <EmptyState message="No documents yet." />
            ) : (
              <ul className="space-y-2.5">
                {detail.documents.map((d) => (
                  <li key={d.id} className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink" title={d.name}>
                        {d.name}
                      </p>
                      <p className="text-[11px] text-ink-faint">{fmtDate(d.updatedAt)}</p>
                    </div>
                    <DocStatusBadge status={d.reviewStatus} />
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Quarterly report"
            action={detail.latestReport ? <ReportStatusBadge status={detail.latestReport.status} /> : undefined}
          >
            {detail.latestReport ? (
              <div>
                <p className="text-sm font-medium text-ink">
                  {detail.latestReport.quarter} · {STAGE_LABELS[detail.latestReport.stageAtGeneration]}
                </p>
                <ul className="mt-3 list-disc space-y-1.5 pl-4 text-sm text-ink-soft marker:text-gold">
                  {detail.latestReport.highlights.map((h) => (
                    <li key={h}>{h}</li>
                  ))}
                </ul>
                <p className="mt-3 border-t border-line/70 pt-3 text-xs leading-relaxed text-ink-soft">
                  <span className="font-medium text-ink">Next quarter:</span>{" "}
                  {detail.latestReport.focusForNextQuarter}
                </p>
              </div>
            ) : (
              <EmptyState message="No report generated yet." />
            )}
          </SectionCard>

          <SectionCard title="Notes">
            {detail.notes.length === 0 ? (
              <EmptyState message="No notes yet." />
            ) : (
              <ul className="space-y-3.5">
                {detail.notes.map((n) => (
                  <li key={n.id}>
                    <p className="text-sm leading-relaxed text-ink-soft">{n.body}</p>
                    <p className="mt-1 text-[11px] text-ink-faint">{fmtDate(n.createdAt)}</p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Profile">
            <dl className="space-y-2.5 text-sm">
              <ProfileRow label="Email" value={record.email} />
              <ProfileRow label="Phone" value={record.phone} />
              <ProfileRow label="Advisor" value={detail.assignedStaff?.name ?? "Unassigned"} />
              <ProfileRow label="Joined" value={fmtDate(record.joinedAt)} />
              {detail.financialProfile ? (
                <ProfileRow
                  label="Monthly income"
                  value={fmtMoney(detail.financialProfile.monthlyIncomeCents)}
                />
              ) : null}
            </dl>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}

function MiniStat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-line/70 bg-ivory px-3.5 py-2.5">
      <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-ink-soft">{label}</p>
      <p className="mt-1 font-display text-xl leading-none text-ink">{value}</p>
      {hint ? <p className="mt-1 text-[11px] text-ink-faint">{hint}</p> : null}
    </div>
  );
}

function MilestoneMarker({ status }: { status: "completed" | "in_progress" | "upcoming" }) {
  if (status === "completed") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-status-good text-[10px] font-bold text-ivory-ink">
        ✓
      </span>
    );
  }
  if (status === "in_progress") {
    return (
      <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full border-2 border-gold">
        <span className="h-2 w-2 rounded-full bg-gold" />
      </span>
    );
  }
  return <span className="mt-0.5 h-5 w-5 shrink-0 rounded-full border-2 border-line" />;
}

function ActionMarker({ done, inProgress }: { done: boolean; inProgress: boolean }) {
  return (
    <span
      className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border text-[9px] font-bold ${
        done
          ? "border-status-good bg-status-good text-ivory-ink"
          : inProgress
            ? "border-gold bg-status-warn-tint text-gold-deep"
            : "border-line bg-ivory"
      }`}
    >
      {done ? "✓" : inProgress ? "·" : ""}
    </span>
  );
}

function ProfileRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="shrink-0 text-xs text-ink-faint">{label}</dt>
      <dd className="truncate text-right text-ink-soft" title={value}>
        {value}
      </dd>
    </div>
  );
}
