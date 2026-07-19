import {
  documentTransitionsFrom,
  fullName,
  hasActiveConsent,
  intakeCompleteness,
  isChannelEnabled,
  LIFECYCLE_STAGES,
  NOTIFICATION_DEFAULT_CHANNELS,
  NOTIFICATION_TYPES,
  PARTNER_CATEGORY_LABELS,
  PARTNER_REFERRAL_STATUS_LABELS,
  projectedMonthlySavingsCents,
  quarterOf,
  REFERRAL_OUTCOME_LABELS,
  REVIEW_REASON_DESCRIPTIONS,
  roadmapTransitionsFrom,
  totalRoundUpCents,
  type DocumentReviewStatusId,
  type HandoffFacts,
  type HandoffVerdict,
  type NotificationChannel,
  type NotificationType,
  type PartnerReferralStatus,
  type RoadmapStatus,
} from "@aflo/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { AgentSuggestionCard } from "@/components/agent-card";
import {
  Badge,
  DocStatusBadge,
  EngagementBadge,
  IntakeStatusBadge,
  KindBadge,
  ClientStatusBadge,
  PipelineBadge,
  ReportStatusBadge,
  RoadmapStatusBadge,
  StageBadge,
} from "@/components/badges";
import {
  addMonthlyActionAction,
  addNoteAction,
  addVirtualTransactionAction,
  assignEducationAction,
  completeEducationAction,
  createGoalAction,
  createReferralAction,
  generateHandoffAction,
  generateReportAction,
  recordReferralOutcomeAction,
  requestDocumentAction,
  revokeHandoffAction,
  runReadinessAssessmentAction,
  scheduleAppointmentAction,
  setNotificationPreferenceAction,
  setPrimaryGoalAction,
  transitionDocumentAction,
  transitionMonthlyActionAction,
  transitionReferralAction,
  transitionReportAction,
  transitionRoadmapAction,
  updateGoalProgressAction,
} from "./actions";
import { StageTrack } from "@/components/stage";
import { EmptyState, ProgressBar, SectionCard } from "@/components/ui";
import { DEMO_ORG_ID, clientRepository, demoNow, store } from "@/lib/data";
import {
  ACTION_STATUS_LABELS,
  fmtDate,
  fmtDateTime,
  fmtMoney,
  fmtMoneyCents,
  fmtMonth,
  fmtPct,
  REASON_CODE_LABELS,
  STAGE_LABELS,
} from "@/lib/format";

export const metadata = { title: "Client detail" };

/** Referral status → badge tone. */
const REFERRAL_TONE = {
  suggested: "neutral",
  shared_with_client: "calm",
  client_engaged: "gold",
  outcome_recorded: "good",
  declined: "neutral",
} as const satisfies Record<PartnerReferralStatus, string>;

/** Verdict → badge tone/label for a verified handoff package. */
const HANDOFF_VERDICT = {
  VALID: { tone: "good", label: "Valid signature" },
  REVOKED: { tone: "neutral", label: "Revoked" },
  EXPIRED: { tone: "warn", label: "Expired" },
  DIGEST_MISMATCH: { tone: "risk", label: "Tampered — digest mismatch" },
  SIGNATURE_INVALID: { tone: "risk", label: "Invalid signature" },
  UNKNOWN_KEY: { tone: "risk", label: "Unknown key" },
  PACKAGE_NOT_FOUND: { tone: "risk", label: "Not found" },
} as const satisfies Record<HandoffVerdict | "PACKAGE_NOT_FOUND", { tone: string; label: string }>;

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
  const intake = store.intakeFor(DEMO_ORG_ID, clientId);
  const intakeDefinition = store.intakeDefinitionFor(DEMO_ORG_ID);
  const resolutionReadout = store.resolutionReadoutFor(DEMO_ORG_ID, clientId, demoNow);
  const creditReport = await store.creditReportSummaryFor(DEMO_ORG_ID, clientId, demoNow);
  const upcomingAppointments = store
    .database()
    .appointments.filter((ap) => ap.clientId === clientId && new Date(ap.scheduledAt) > demoNow)
    .sort((x, y) => x.scheduledAt.localeCompare(y.scheduledAt));
  const communications = store.communicationsFor(DEMO_ORG_ID, clientId).slice(-6).reverse();
  const notificationPrefs = store.notificationPreferencesFor(DEMO_ORG_ID, clientId);
  const partners = store.partnersFor(DEMO_ORG_ID);
  const partnerById = new Map(partners.map((p) => [p.id, p]));
  const referrals = store.referralsFor(DEMO_ORG_ID, clientId);
  const handoffPackages = store
    .handoffPackagesFor(DEMO_ORG_ID, clientId)
    .map((pkg) => ({ pkg, verdict: store.verifyHandoffPackageById(DEMO_ORG_ID, pkg.id).verdict }))
    .reverse();
  const handoffConsent = hasActiveConsent(
    store.database().consentRecords,
    clientId,
    "partner_data_sharing",
  );
  const canGenerateHandoff =
    record.kind === "client" && handoffConsent && detail.latestAssessmentRecord != null;
  const education = store.educationFor(DEMO_ORG_ID, clientId);
  const simulation = store.simulationFor(DEMO_ORG_ID, clientId);
  const virtualTransactions = store.virtualTransactionsFor(DEMO_ORG_ID, clientId);
  const roundUpTotalCents = simulation
    ? totalRoundUpCents(
        virtualTransactions.map((t) => t.amountCents),
        { roundToCents: simulation.roundToCents, multiplier: simulation.multiplier, enabled: simulation.enabled },
      )
    : 0;
  const roundUpWindowDays =
    virtualTransactions.length > 1
      ? Math.max(
          1,
          Math.round(
            (Date.parse(virtualTransactions[0]!.occurredOn) -
              Date.parse(virtualTransactions[virtualTransactions.length - 1]!.occurredOn)) /
              (1000 * 60 * 60 * 24),
          ),
        )
      : 30;
  const projectedMonthlyCents = projectedMonthlySavingsCents(roundUpTotalCents, roundUpWindowDays);
  const intakeProgress =
    intake && intakeDefinition
      ? intakeCompleteness(intakeDefinition, intake.completedSectionIds)
      : null;

  return (
    <div className="space-y-6">
      <Link href="/clients" className="text-xs font-medium text-ink-soft hover:text-emerald">
        ← Clients
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink">{name}</h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <KindBadge kind={record.kind} />
            <PipelineBadge label={detail.pipelineStageLabel} />
            {record.clientStatus ? <ClientStatusBadge status={record.clientStatus} /> : null}
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
            <div className="mb-5 rounded-md border border-line/70 bg-ivory px-4 py-3.5">
              {detail.latestAssessmentRecord ? (
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm text-ink">
                      <span className="font-medium">Recorded:</span>{" "}
                      {STAGE_LABELS[detail.latestAssessmentRecord.stage]} ·{" "}
                      {fmtDate(detail.latestAssessmentRecord.assessedAt)}
                      {detail.latestAssessmentRecord.previousStage
                        ? ` · previously ${STAGE_LABELS[detail.latestAssessmentRecord.previousStage]}`
                        : ""}
                    </p>
                    {detail.latestAssessmentRecord.requiresHumanReview ? (
                      <Badge tone="warn" label="Review required" />
                    ) : null}
                  </div>
                  {detail.latestAssessmentRecord.requiresHumanReview ? (
                    <p className="text-xs text-gold-deep">
                      {detail.latestAssessmentRecord.reviewReasonCodes
                        .map((code) => REVIEW_REASON_DESCRIPTIONS[code])
                        .join(" · ")}
                    </p>
                  ) : null}
                  <p className="text-xs text-ink-soft">
                    <span className="font-medium text-ink">Proposed next action:</span>{" "}
                    {detail.latestAssessmentRecord.proposedNextAction}
                  </p>
                </div>
              ) : (
                <p className="text-sm text-ink-soft">
                  No recorded assessment yet — the workflow records stage, reason codes, and the
                  proposed next action from verified facts.
                </p>
              )}
              <div className="mt-3">
                {intake?.status === "completed" && detail.financialProfile && detail.creditProfile ? (
                  <form action={runReadinessAssessmentAction.bind(null, clientId)}>
                    <button
                      type="submit"
                      className="rounded-md bg-emerald px-3.5 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                    >
                      {detail.latestAssessmentRecord ? "Re-run assessment" : "Run assessment"}
                    </button>
                  </form>
                ) : intake?.status !== "completed" ? (
                  <p className="text-xs text-ink-faint">
                    Assessment opens once the intake completes.
                  </p>
                ) : (
                  <p className="text-xs text-ink-faint">
                    Blocked — missing{" "}
                    {[
                      !detail.financialProfile && "financial profile",
                      !detail.creditProfile && "credit profile",
                    ]
                      .filter(Boolean)
                      .join(" and ")}{" "}
                    data. Attempts are audited, never recorded.
                  </p>
                )}
              </div>
            </div>
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

          {resolutionReadout ? (
            <SectionCard
              title="Resolution readout"
              subtitle="Concierge substrate · understand → diagnose → organize (deterministic, read-only)"
              action={
                <Badge
                  tone={resolutionReadout.canRunDiagnosis ? "good" : "neutral"}
                  label={resolutionReadout.canRunDiagnosis ? "Ready to diagnose" : "Awaiting inputs"}
                />
              }
            >
              <div className="space-y-5">
                <div>
                  <div className="flex items-center justify-between">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                      Understand
                    </p>
                    <span className="text-xs text-ink-faint">
                      {resolutionReadout.understanding.completionPct}% of inputs captured
                    </span>
                  </div>
                  <div className="mt-2">
                    <ProgressBar pct={resolutionReadout.understanding.completionPct} />
                  </div>
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {resolutionReadout.understanding.capturedKeys.map((k) => (
                      <span
                        key={k}
                        className="rounded bg-status-good-tint px-2 py-0.5 text-[11px] text-emerald-deep"
                      >
                        {READINESS_INPUT_LABELS[k] ?? k}
                      </span>
                    ))}
                    {resolutionReadout.understanding.missingKeys.map((k) => {
                      const blocks = resolutionReadout.understanding.blockingMissingKeys.includes(k);
                      return (
                        <span
                          key={k}
                          className={`rounded px-2 py-0.5 text-[11px] ${
                            blocks ? "bg-status-warn-tint text-gold-deep" : "bg-sand text-ink-faint"
                          }`}
                        >
                          {READINESS_INPUT_LABELS[k] ?? k} · missing{blocks ? " (blocks)" : ""}
                        </span>
                      );
                    })}
                  </div>
                  <p className="mt-2 text-[11px] text-ink-faint">
                    {resolutionReadout.canRunDiagnosis
                      ? "All required inputs captured and intake complete — the diagnosis can run."
                      : resolutionReadout.understanding.canDiagnose
                        ? "Required facts captured, but the intake is not yet complete."
                        : "Required facts still missing before a diagnosis can run."}
                  </p>
                </div>

                <div className="border-t border-line/70 pt-4">
                  <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                    Diagnose
                  </p>
                  {resolutionReadout.diagnosis ? (
                    <div className="mt-2 space-y-1">
                      <p className="text-sm text-ink">
                        <span className="font-medium">
                          {STAGE_LABELS[resolutionReadout.diagnosis.stage]}
                        </span>
                        {resolutionReadout.diagnosis.bindingBlocker ? (
                          <> · binding blocker: {REASON_CODE_LABELS[resolutionReadout.diagnosis.bindingBlocker]}</>
                        ) : null}
                      </p>
                      <p className="text-xs text-ink-soft">
                        <span className="font-medium text-ink">Proposed next action:</span>{" "}
                        {resolutionReadout.diagnosis.proposedNextAction}
                      </p>
                    </div>
                  ) : (
                    <p className="mt-2 text-xs text-ink-soft">
                      No recorded assessment yet — this mirrors the workflow&rsquo;s diagnosis and is
                      never re-run here.
                    </p>
                  )}
                </div>

                {resolutionReadout.obligations ? (
                  <div className="border-t border-line/70 pt-4">
                    <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                      Organize · obligations
                    </p>
                    <div className="mt-2.5 grid grid-cols-3 gap-3">
                      <MiniStat
                        label="Debt-to-income"
                        value={fmtPct(resolutionReadout.obligations.dtiPct, 1)}
                      />
                      <MiniStat
                        label="Utilization"
                        value={fmtPct(resolutionReadout.obligations.utilizationPct, 1)}
                        hint="revolving"
                      />
                      <MiniStat
                        label="Monthly debt"
                        value={fmtMoney(resolutionReadout.obligations.monthlyDebtPaymentsCents)}
                      />
                    </div>
                  </div>
                ) : null}

                <p className="border-t border-line/70 pt-3 text-[11px] leading-relaxed text-ink-faint">
                  Composed read-only from verified facts — no AI, no changes. Rule provenance:{" "}
                  {resolutionReadout.ruleVersions.join(" · ")}.
                </p>
              </div>
            </SectionCard>
          ) : null}

          <SectionCard
            title="Roadmap"
            subtitle={`${milestonesDone} of ${detail.milestones.length} milestones complete`}
            action={detail.roadmap ? <RoadmapStatusBadge status={detail.roadmap.status} /> : undefined}
          >
            {detail.roadmap ? (
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-md border border-line/70 bg-ivory px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-medium text-ink" title={detail.roadmap.title}>
                    {detail.roadmap.title}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-faint">
                    {detail.roadmap.aiRunId ? "AI-drafted language" : "Manually authored"} · created by{" "}
                    {staffName(detail.roadmap.createdByStaffId)}
                    {detail.roadmap.approvedByStaffId
                      ? ` · approved by ${staffName(detail.roadmap.approvedByStaffId)}`
                      : ""}
                    {detail.roadmap.publishedAt
                      ? ` · published ${fmtDate(detail.roadmap.publishedAt)}`
                      : ""}
                  </p>
                </div>
                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  {roadmapActions(detail.roadmap.status).map(({ toStatus, label, primary }) => (
                    <form
                      key={toStatus}
                      action={transitionRoadmapAction.bind(null, clientId, detail.roadmap!.id, toStatus)}
                    >
                      <button
                        type="submit"
                        className={
                          primary
                            ? "rounded-md bg-emerald px-3 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                            : "rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-gold/60 hover:text-gold-deep"
                        }
                      >
                        {label}
                      </button>
                    </form>
                  ))}
                </div>
              </div>
            ) : null}
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
                  <li key={action.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
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
                      <span className="flex items-center gap-1.5">
                        {action.status === "todo" ? (
                          <form action={transitionMonthlyActionAction.bind(null, clientId, action.id, "in_progress")}>
                            <ActionButton label="Start" />
                          </form>
                        ) : null}
                        {action.status !== "done" ? (
                          <form action={transitionMonthlyActionAction.bind(null, clientId, action.id, "done")}>
                            <ActionButton label="Complete" primary />
                          </form>
                        ) : (
                          <form action={transitionMonthlyActionAction.bind(null, clientId, action.id, "todo")}>
                            <ActionButton label="Reopen" />
                          </form>
                        )}
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form
              action={addMonthlyActionAction.bind(null, clientId)}
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-line/70 pt-4"
            >
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  New action
                </span>
                <input
                  name="title"
                  required
                  placeholder="What should happen this month?"
                  className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                />
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  Category
                </span>
                <select
                  name="category"
                  className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                  defaultValue="habit"
                >
                  <option value="payment">Payment</option>
                  <option value="savings">Savings</option>
                  <option value="documentation">Documentation</option>
                  <option value="education">Education</option>
                  <option value="habit">Habit</option>
                </select>
              </label>
              <label>
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  Due
                </span>
                <input
                  name="dueDate"
                  type="date"
                  required
                  className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                />
              </label>
              <button
                type="submit"
                className="rounded-md bg-emerald px-3.5 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
              >
                Add action
              </button>
            </form>
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
          <SectionCard
            title="Intake"
            action={
              <Link
                href={`/clients/${clientId}/intake`}
                className="text-xs font-medium text-emerald hover:text-emerald-deep"
              >
                Open workspace →
              </Link>
            }
          >
            {intake && intakeProgress ? (
              <div className="space-y-3">
                <IntakeStatusBadge status={intake.status} />
                <ProgressBar
                  pct={(intakeProgress.completedRequiredCount / intakeProgress.requiredCount) * 100}
                  label={`${intakeProgress.completedRequiredCount}/${intakeProgress.requiredCount}`}
                />
                <p className="text-xs text-ink-faint">
                  {intake.status === "completed" && intake.completedAt
                    ? `Completed ${fmtDate(intake.completedAt)}`
                    : `${intakeProgress.completedRequiredCount} of ${intakeProgress.requiredCount} required sections complete`}
                </p>
              </div>
            ) : (
              <EmptyState message="Not started — opens when the lead reaches Intake started." />
            )}
          </SectionCard>

          <SectionCard title="Goals">
            {primaryGoal ? (
              <div>
                <p className="text-sm font-medium text-ink">{primaryGoal.title}</p>
                <p className="mt-1 text-xs text-ink-faint">Target {fmtDate(primaryGoal.targetDate)}</p>
                <div className="mt-3">
                  <ProgressBar pct={primaryGoal.progressPct} />
                </div>
                <form
                  action={updateGoalProgressAction.bind(null, clientId, primaryGoal.id)}
                  className="mt-2 flex items-center gap-2"
                >
                  <input
                    name="progressPct"
                    type="number"
                    min="0"
                    max="100"
                    defaultValue={primaryGoal.progressPct}
                    className="w-16 rounded-md border border-line bg-card px-2 py-1 text-xs text-ink"
                  />
                  <ActionButton label="Update %" />
                </form>
                {otherGoals.length > 0 ? (
                  <ul className="mt-4 space-y-2 border-t border-line/70 pt-3">
                    {otherGoals.map((g) => (
                      <li key={g.id} className="flex items-center justify-between gap-2 text-xs">
                        <span className="min-w-0 truncate text-ink-soft">
                          {g.title} · {g.progressPct}%
                        </span>
                        <form action={setPrimaryGoalAction.bind(null, clientId, g.id)}>
                          <ActionButton label="Make primary" />
                        </form>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No goal set yet." />
            )}
            <form
              action={createGoalAction.bind(null, clientId)}
              className="mt-4 space-y-2 border-t border-line/70 pt-4"
            >
              <input
                name="title"
                required
                placeholder="New goal"
                className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex flex-wrap items-center gap-2">
                <select
                  name="category"
                  className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                  defaultValue="savings"
                >
                  <option value="credit">Credit</option>
                  <option value="savings">Savings</option>
                  <option value="debt">Debt</option>
                  <option value="home_purchase">Home purchase</option>
                  <option value="business_capital">Business capital</option>
                  <option value="other">Other</option>
                </select>
                <input
                  name="targetDate"
                  type="date"
                  required
                  className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                />
                <label className="flex items-center gap-1.5 text-xs text-ink-soft">
                  <input name="isPrimary" type="checkbox" /> Primary
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-emerald px-3 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                >
                  Add goal
                </button>
              </div>
            </form>
          </SectionCard>

          <SectionCard title="Documents">
            {detail.documents.length === 0 ? (
              <EmptyState message="No documents yet." />
            ) : (
              <ul className="space-y-2.5">
                {detail.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink" title={d.name}>
                        {d.name}
                      </p>
                      <p className="text-[11px] text-ink-faint">{fmtDate(d.updatedAt)}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      {documentTransitionsFrom(d.reviewStatus).map((to) => (
                        <form key={to} action={transitionDocumentAction.bind(null, clientId, d.id, to)}>
                          <ActionButton
                            label={DOC_ACTION_LABELS[to]?.(d.reviewStatus) ?? to}
                            primary={to === "approved"}
                          />
                        </form>
                      ))}
                      <DocStatusBadge status={d.reviewStatus} />
                    </div>
                  </li>
                ))}
              </ul>
            )}
            <form
              action={requestDocumentAction.bind(null, clientId)}
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-line/70 pt-4"
            >
              <label className="min-w-0 flex-1">
                <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  Request document
                </span>
                <input
                  name="name"
                  required
                  placeholder="Document name"
                  className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                />
              </label>
              <select
                name="docType"
                className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                defaultValue="other"
              >
                <option value="credit_report">Credit report</option>
                <option value="income_verification">Income verification</option>
                <option value="bank_statement">Bank statement</option>
                <option value="identification">Identification</option>
                <option value="other">Other</option>
              </select>
              <button
                type="submit"
                className="rounded-md bg-emerald px-3 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
              >
                Request
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title="Credit report (synthetic)"
            subtitle="Mock provider — not bureau data · never changes readiness"
            action={<Badge tone="neutral" label="Synthetic" />}
          >
            {creditReport?.available && creditReport.facts ? (
              <div className="space-y-3">
                <div className="grid grid-cols-2 gap-3">
                  <MiniStat
                    label="Reported score"
                    value={creditReport.facts.primaryScore !== null ? String(creditReport.facts.primaryScore) : "—"}
                    hint={creditReport.facts.primaryScoreModel ?? undefined}
                  />
                  <MiniStat
                    label="Utilization"
                    value={creditReport.facts.utilizationPct !== null ? fmtPct(creditReport.facts.utilizationPct, 1) : "—"}
                    hint="revolving"
                  />
                  <MiniStat label="Open tradelines" value={String(creditReport.facts.openTradelines)} />
                  <MiniStat
                    label="Hard inquiries"
                    value={String(creditReport.facts.hardInquiriesTrailingYear)}
                    hint="trailing year"
                  />
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft">
                  <dt className="text-ink-faint">Derogatory marks</dt>
                  <dd className="text-right text-ink">{creditReport.facts.derogatoryMarks}</dd>
                  <dt className="text-ink-faint">On-time rate</dt>
                  <dd className="text-right text-ink">{fmtPct(creditReport.facts.onTimePaymentRate * 100, 0)}</dd>
                </dl>
                <p className="rounded-md border border-line bg-neutral-tint px-3 py-2 text-[11px] leading-relaxed text-ink-soft">
                  Synthetic mock data ({creditReport.source})
                  {creditReport.pulledAt ? `, pulled ${fmtDate(creditReport.pulledAt)}` : ""} —{" "}
                  <span className="font-medium">not a bureau report</span>. Staff must verify; these
                  figures never auto-update the credit profile or the readiness assessment.
                </p>
              </div>
            ) : creditReport?.reason === "consent_required" ? (
              <EmptyState message="Data-processing consent required before a credit-report summary can be shown." />
            ) : (
              <EmptyState message="No synthetic credit report on file." />
            )}
          </SectionCard>

          <SectionCard title="Appointments">
            {upcomingAppointments.length === 0 ? (
              <EmptyState message="No upcoming appointments." />
            ) : (
              <ul className="space-y-2.5">
                {upcomingAppointments.map((ap) => (
                  <li key={ap.id}>
                    <p className="text-sm text-ink">{ap.purpose}</p>
                    <p className="text-[11px] text-ink-faint">
                      {fmtDateTime(ap.scheduledAt)} · {ap.channel.replace("_", " ")}
                    </p>
                  </li>
                ))}
              </ul>
            )}
            <form
              action={scheduleAppointmentAction.bind(null, clientId)}
              className="mt-4 space-y-2 border-t border-line/70 pt-4"
            >
              <input
                name="purpose"
                required
                placeholder="Purpose"
                className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
              />
              <div className="flex flex-wrap items-center gap-2">
                <input
                  name="scheduledAt"
                  type="datetime-local"
                  required
                  className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                />
                <select
                  name="channel"
                  className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
                  defaultValue="video"
                >
                  <option value="video">Video</option>
                  <option value="phone">Phone</option>
                  <option value="in_person">In person</option>
                </select>
                <button
                  type="submit"
                  className="rounded-md bg-emerald px-3 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                >
                  Schedule
                </button>
              </div>
            </form>
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
                {detail.latestReport.status !== "published" ? (
                  <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
                    {detail.latestReport.status === "draft" ? (
                      <form
                        action={transitionReportAction.bind(null, clientId, detail.latestReport.id, "ready_for_review")}
                      >
                        <ActionButton label="Submit for review" primary />
                      </form>
                    ) : (
                      <>
                        <form
                          action={transitionReportAction.bind(null, clientId, detail.latestReport.id, "published")}
                        >
                          <ActionButton label="Publish" primary />
                        </form>
                        <form
                          action={transitionReportAction.bind(null, clientId, detail.latestReport.id, "draft")}
                        >
                          <ActionButton label="Return to draft" />
                        </form>
                      </>
                    )}
                  </div>
                ) : null}
              </div>
            ) : (
              <EmptyState message="No report generated yet." />
            )}
            {record.kind === "client" &&
            detail.latestAssessmentRecord &&
            detail.latestReport?.quarter !== quarterOf(new Date()) ? (
              <form action={generateReportAction.bind(null, clientId)} className="mt-4">
                <button
                  type="submit"
                  className="rounded-md bg-emerald px-3.5 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                >
                  Generate {quarterOf(new Date())} report
                </button>
                <p className="mt-2 text-[11px] text-ink-faint">
                  Drafted deterministically from recorded facts; staff review gates publication.
                </p>
              </form>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Verification handoff"
            subtitle="Signed, tamper-evident package of verified facts — not a bureau report"
          >
            {handoffPackages.length > 0 ? (
              <ul className="space-y-3">
                {handoffPackages.map(({ pkg, verdict }) => {
                  const facts = pkg.payload as HandoffFacts;
                  const v = HANDOFF_VERDICT[verdict];
                  return (
                    <li key={pkg.id} className="rounded-md border border-line bg-card px-3.5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <p className="text-sm font-medium text-ink">{pkg.recipientScope}</p>
                        <Badge tone={v.tone} label={v.label} />
                      </div>
                      <dl className="mt-2.5 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-ink-soft">
                        <dt className="text-ink-faint">Readiness stage</dt>
                        <dd className="text-right text-ink">{facts.afloReadinessStageLabel}</dd>
                        <dt className="text-ink-faint">Primary goal</dt>
                        <dd className="text-right text-ink">{facts.primaryGoal?.title ?? "—"}</dd>
                        <dt className="text-ink-faint">Verified documents</dt>
                        <dd className="text-right text-ink">{facts.verifiedDocumentCount}</dd>
                        <dt className="text-ink-faint">Latest report</dt>
                        <dd className="text-right text-ink">{facts.latestPublishedReportQuarter ?? "—"}</dd>
                      </dl>
                      <p className="mt-2.5 break-all border-t border-line/70 pt-2 font-mono text-[11px] leading-relaxed text-ink-faint">
                        digest {pkg.payloadDigest.slice(0, 24)}… · {pkg.algorithm} · {pkg.keyId}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-faint">
                        Issued {fmtDate(pkg.issuedAt)} · expires {fmtDate(pkg.expiresAt)}
                        {pkg.revokedAt ? ` · revoked ${fmtDate(pkg.revokedAt)}` : ""}
                      </p>
                      {verdict !== "REVOKED" ? (
                        <form action={revokeHandoffAction.bind(null, clientId, pkg.id)} className="mt-2.5">
                          <ActionButton label="Revoke" />
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState message="No handoff package issued yet." />
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              A handoff carries the ΛFLO readiness stage (never a credit-bureau score) and verified-fact
              counts — no SSN, bank, or raw credit-report data. It is tamper-evident, not audit-proof or
              legally verified.
            </p>
            {canGenerateHandoff ? (
              <form
                action={generateHandoffAction.bind(null, clientId)}
                className="mt-3 flex flex-wrap items-end gap-2 border-t border-line/70 pt-4"
              >
                <input
                  name="recipientScope"
                  required
                  placeholder="Recipient (e.g. partner-cpa:acme-tax)"
                  className="min-w-0 flex-1 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                />
                <button
                  type="submit"
                  className="rounded-md bg-emerald px-3.5 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                >
                  Generate &amp; sign
                </button>
              </form>
            ) : (
              <p className="mt-3 rounded-md border border-line bg-neutral-tint px-3 py-2 text-xs text-ink-soft">
                {record.kind !== "client"
                  ? "Available once the lead is an activated client."
                  : !handoffConsent
                    ? "Blocked: the client has not granted partner-data-sharing consent."
                    : "Blocked: run a readiness assessment first — a handoff must assert a verified stage."}
              </p>
            )}
          </SectionCard>

          <SectionCard
            title="Round-up simulator"
            subtitle="Simulation only — hypothetical, never moves money"
            action={
              simulation ? (
                <span className="font-display text-lg text-emerald-deep">
                  {fmtMoney(projectedMonthlyCents)}/mo
                </span>
              ) : undefined
            }
          >
            {simulation ? (
              <div className="space-y-3">
                <p className="text-xs text-ink-soft">
                  Rounding to {fmtMoneyCents(simulation.roundToCents)} × {simulation.multiplier}
                  {simulation.enabled ? "" : " (paused)"} · projected from{" "}
                  {virtualTransactions.length} sample transaction
                  {virtualTransactions.length === 1 ? "" : "s"}
                </p>
                {primaryGoal ? (
                  <p className="rounded-md bg-status-good-tint px-3 py-2 text-xs text-emerald-deep">
                    ≈ {fmtMoney(projectedMonthlyCents * 12)}/yr toward &ldquo;{primaryGoal.title}&rdquo;
                  </p>
                ) : null}
                <ul className="divide-y divide-line/60">
                  {virtualTransactions.slice(0, 5).map((t) => (
                    <li key={t.id} className="flex items-center justify-between gap-2 py-1.5 text-xs">
                      <span className="truncate text-ink-soft">{t.label}</span>
                      <span className="shrink-0 text-ink-faint">
                        {fmtMoneyCents(t.amountCents)} → +{fmtMoneyCents(t.roundUpAmountCents)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : (
              <EmptyState message="Not enabled — add a hypothetical transaction to start the simulation." />
            )}
            <form
              action={addVirtualTransactionAction.bind(null, clientId)}
              className="mt-4 flex flex-wrap items-end gap-2 border-t border-line/70 pt-4"
            >
              <input
                name="label"
                required
                placeholder="Label (e.g. Coffee)"
                className="min-w-0 flex-1 rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
              />
              <input
                name="amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                placeholder="Amount"
                className="w-24 rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
              />
              <input
                name="occurredOn"
                type="date"
                required
                className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
              />
              <button
                type="submit"
                className="rounded-md bg-emerald px-3 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
              >
                Add
              </button>
            </form>
          </SectionCard>

          <SectionCard
            title="Communications"
            subtitle="Consent-gated — suppressed sends are recorded, never silently dropped"
          >
            {communications.length === 0 ? (
              <EmptyState message="No communications yet this session." />
            ) : (
              <ul className="space-y-2.5">
                {communications.map((c) => (
                  <li key={c.id} className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">
                        {c.subject ?? c.notificationType.replace(/_/g, " ")}
                      </p>
                      <p className="text-[11px] text-ink-faint">
                        {c.channel} · {fmtDateTime(c.occurredAt)}
                      </p>
                    </div>
                    {c.status === "sent" ? (
                      <Badge tone="good" label="Sent" />
                    ) : (
                      <Badge
                        tone="neutral"
                        label={
                          c.suppressionReason === "CHANNEL_DISABLED"
                            ? "Off by preference"
                            : "Suppressed — no consent"
                        }
                      />
                    )}
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard
            title="Wealth Academy"
            subtitle="Deterministic assignment · completion is educational only"
          >
            {education.length === 0 ? (
              <EmptyState message="No lessons assigned yet." />
            ) : (
              <ul className="space-y-2.5">
                {education.map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm text-ink">{e.lessonId.replace("lsn-", "").replace(/-/g, " ")}</p>
                      <p className="text-[11px] text-ink-faint">
                        {e.reasonCode} · v{e.contentVersion}
                        {e.knowledgeCheckScore !== null ? ` · check ${Math.round(e.knowledgeCheckScore * 100)}%` : ""}
                      </p>
                    </div>
                    {e.completedAt ? (
                      <Badge tone="good" label="Completed" />
                    ) : (
                      <form action={completeEducationAction.bind(null, clientId, e.id)}>
                        <ActionButton label="Mark complete" />
                      </form>
                    )}
                  </li>
                ))}
              </ul>
            )}
            <form
              action={assignEducationAction.bind(null, clientId, "missing_document")}
              className="mt-4 border-t border-line/70 pt-4"
            >
              <ActionButton label="Assign: Documents that build trust" />
            </form>
          </SectionCard>

          <SectionCard
            title="Notification preferences"
            subtitle="Granular per channel · enforced before every send"
          >
            <ul className="space-y-3">
              {NOTIFICATION_TYPES.map((type) => (
                <li key={type}>
                  <p className="text-xs font-medium text-ink">{NOTIFICATION_TYPE_LABELS[type]}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {NOTIFICATION_DEFAULT_CHANNELS[type].map((channel) => {
                      const enabled = isChannelEnabled(notificationPrefs, clientId, type, channel);
                      return (
                        <form
                          key={channel}
                          action={setNotificationPreferenceAction.bind(null, clientId, type, channel, !enabled)}
                        >
                          <button
                            type="submit"
                            aria-pressed={enabled}
                            className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors ${
                              enabled
                                ? "border-emerald/40 bg-status-good-tint text-emerald-deep"
                                : "border-line bg-ivory text-ink-faint line-through"
                            }`}
                            title={`${NOTIFICATION_CHANNEL_LABELS[channel]}: ${enabled ? "on — click to turn off" : "off — click to turn on"}`}
                          >
                            {NOTIFICATION_CHANNEL_LABELS[channel]}
                          </button>
                        </form>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </SectionCard>

          <SectionCard
            title="Partner referrals"
            subtitle="Routing to licensed partners — neutrality recorded, never an approval"
          >
            {referrals.length > 0 ? (
              <ul className="space-y-3">
                {referrals.map((r) => {
                  const partner = partnerById.get(r.partnerId);
                  return (
                    <li key={r.id} className="rounded-md border border-line bg-card px-3.5 py-3">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <p className="text-sm font-medium text-ink">{partner?.name ?? r.partnerId}</p>
                          <p className="text-[11px] text-ink-faint">
                            {partner ? PARTNER_CATEGORY_LABELS[partner.category] : "Partner"}
                            {partner?.nonCommercial ? " · non-commercial" : ""}
                          </p>
                        </div>
                        <Badge tone={REFERRAL_TONE[r.status]} label={PARTNER_REFERRAL_STATUS_LABELS[r.status]} />
                      </div>
                      <dl className="mt-2.5 space-y-1 text-xs text-ink-soft">
                        <div>
                          <dt className="inline font-medium text-ink">Why shown: </dt>
                          <dd className="inline">{r.neutrality.whyShown}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-ink">Compensation: </dt>
                          <dd className="inline">{r.neutrality.compensationDisclosure}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-ink">Est. cost: </dt>
                          <dd className="inline">{r.neutrality.estimatedUserCost}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-ink">Key risks: </dt>
                          <dd className="inline">{r.neutrality.keyRisks}</dd>
                        </div>
                        <div>
                          <dt className="inline font-medium text-ink">Alternatives: </dt>
                          <dd className="inline">
                            {r.neutrality.eligibleAlternatives.length > 0
                              ? r.neutrality.eligibleAlternatives.join("; ")
                              : "none eligible"}
                          </dd>
                        </div>
                        <div className="flex flex-wrap gap-2 pt-0.5 text-[11px] text-ink-faint">
                          <span>
                            Non-commercial option {r.neutrality.nonCommercialOptionExists ? "available" : "none"}
                          </span>
                          <span>· Staff reviewed: {r.neutrality.staffReviewed ? "yes" : "no"}</span>
                        </div>
                      </dl>
                      {r.outcome ? (
                        <p className="mt-2.5 rounded-md bg-status-good-tint px-3 py-2 text-xs text-emerald-deep">
                          Outcome: {REFERRAL_OUTCOME_LABELS[r.outcome]}
                          {r.outcomeNote ? ` — ${r.outcomeNote}` : ""}
                        </p>
                      ) : null}
                      {r.status !== "outcome_recorded" && r.status !== "declined" ? (
                        <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line/70 pt-3">
                          {r.status === "suggested" ? (
                            <form action={transitionReferralAction.bind(null, clientId, r.id, "shared_with_client")}>
                              <ActionButton label="Share with client" primary />
                            </form>
                          ) : null}
                          {r.status === "shared_with_client" ? (
                            <form action={transitionReferralAction.bind(null, clientId, r.id, "client_engaged")}>
                              <ActionButton label="Mark engaged" primary />
                            </form>
                          ) : null}
                          {r.status === "client_engaged" ? (
                            <form
                              action={recordReferralOutcomeAction.bind(null, clientId, r.id)}
                              className="flex flex-wrap items-center gap-2"
                            >
                              <select
                                name="outcome"
                                className="rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink"
                              >
                                <option value="engaged_supported_readiness">Engaged — supported readiness</option>
                                <option value="engaged_no_change">Engaged — no readiness change</option>
                                <option value="not_pursued">Not pursued</option>
                              </select>
                              <input
                                name="note"
                                placeholder="Outcome note (optional)"
                                className="min-w-0 flex-1 rounded-md border border-line bg-card px-2 py-1.5 text-xs text-ink placeholder:text-ink-faint"
                              />
                              <ActionButton label="Record outcome" primary />
                            </form>
                          ) : null}
                          <form action={transitionReferralAction.bind(null, clientId, r.id, "declined")}>
                            <ActionButton label="Decline" />
                          </form>
                        </div>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <EmptyState message="No partner referrals yet." />
            )}
            <p className="mt-3 text-[11px] leading-relaxed text-ink-faint">
              Every referral records the eight-field neutrality disclosure. Partner compensation never affects
              a client&rsquo;s readiness, and AFLO never approves a loan or guarantees acceptance.
            </p>
            {record.kind === "client" && partners.length > 0 ? (
              <form
                action={createReferralAction.bind(null, clientId)}
                className="mt-3 space-y-2 border-t border-line/70 pt-4"
              >
                <select
                  name="partnerId"
                  required
                  defaultValue=""
                  className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink"
                >
                  <option value="" disabled>
                    Select a partner…
                  </option>
                  {partners.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} — {PARTNER_CATEGORY_LABELS[p.category]}
                      {p.nonCommercial ? " (non-commercial)" : ""}
                    </option>
                  ))}
                </select>
                <input
                  name="whyShown"
                  required
                  placeholder="Why this option is being shown"
                  className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                />
                <input
                  name="eligibleAlternatives"
                  placeholder="Eligible alternatives (comma-separated)"
                  className="w-full rounded-md border border-line bg-card px-3 py-1.5 text-sm text-ink placeholder:text-ink-faint"
                />
                <label className="flex items-center gap-2 text-xs text-ink-soft">
                  <input type="checkbox" name="staffReviewed" defaultChecked className="rounded border-line" />
                  I have reviewed this recommendation for neutrality
                </label>
                <button
                  type="submit"
                  className="rounded-md bg-emerald px-3.5 py-2 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                >
                  Create referral
                </button>
              </form>
            ) : null}
          </SectionCard>

          <SectionCard title="Notes" subtitle="Internal — never visible in the client portal">
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
            <form
              action={addNoteAction.bind(null, clientId)}
              className="mt-4 space-y-2 border-t border-line/70 pt-4"
            >
              <textarea
                name="body"
                required
                rows={2}
                placeholder="Add an internal note…"
                className="w-full rounded-md border border-line bg-card px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
              />
              <button
                type="submit"
                className="rounded-md bg-emerald px-3 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
              >
                Add note
              </button>
            </form>
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

function staffName(staffId: string): string {
  return (
    store.database().staff.find((s) => s.id === staffId && s.organizationId === DEMO_ORG_ID)?.name ??
    "Unknown"
  );
}

/** Rule-legal roadmap moves surfaced as staff actions (archival stays out of the UI for now). */
function roadmapActions(
  status: RoadmapStatus,
): { toStatus: RoadmapStatus; label: string; primary: boolean }[] {
  return roadmapTransitionsFrom(status)
    .filter((to) => to !== "archived")
    .map((to) => ({
      toStatus: to,
      label:
        to === "staff_review"
          ? "Submit for review"
          : to === "approved"
            ? "Approve"
            : to === "published"
              ? "Publish to client"
              : status === "approved"
                ? "Reopen draft"
                : "Return to draft",
      primary: to !== "draft",
    }));
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

const NOTIFICATION_TYPE_LABELS: Record<NotificationType, string> = {
  appointment_scheduled: "Appointment scheduled",
  roadmap_published: "Roadmap published",
  report_published: "Report published",
  document_requested: "Document requested",
  task_assigned: "Task assigned",
};

const NOTIFICATION_CHANNEL_LABELS: Record<NotificationChannel, string> = {
  in_app: "In-app",
  email: "Email",
  sms: "SMS",
};

/** Staff-facing labels for the readiness inputs the Concierge readout tracks. */
const READINESS_INPUT_LABELS: Record<string, string> = {
  creditScore: "Credit score",
  utilizationPct: "Utilization",
  dtiPct: "Debt-to-income",
  reserveMonths: "Reserves",
  derogatoryMarks: "Derogatory marks",
  onTimePaymentRate: "On-time payments",
  incomeStability: "Income stability",
};

/** Staff-facing labels for rule-legal document moves, keyed by target status. */
const DOC_ACTION_LABELS: Partial<Record<DocumentReviewStatusId, (from: string) => string>> = {
  uploaded: (from) => (from === "needs_attention" ? "Mark re-uploaded" : "Mark uploaded"),
  in_review: () => "Start review",
  approved: () => "Approve",
  needs_attention: () => "Needs attention",
};

function ActionButton({ label, primary = false }: { label: string; primary?: boolean }) {
  return (
    <button
      type="submit"
      className={
        primary
          ? "rounded bg-emerald px-2 py-1 text-[11px] font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
          : "rounded border border-line px-2 py-1 text-[11px] text-ink-soft transition-colors hover:border-gold/60 hover:text-gold-deep"
      }
    >
      {label}
    </button>
  );
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
