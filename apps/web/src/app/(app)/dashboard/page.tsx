import Link from "next/link";
import { EngagementBadge } from "@/components/badges";
import { StageDistribution } from "@/components/stage";
import { EmptyState, SectionCard, StatTile } from "@/components/ui";
import { DEMO_ORG_ID, DEMO_STAFF_NAME, dashboardRepository, demoNow } from "@/lib/data";
import { fmtDateTime, fmtPct, PIPELINE_LABELS } from "@/lib/format";

export const metadata = { title: "Dashboard" };

export default async function DashboardPage() {
  const snapshot = await dashboardRepository.getSnapshot(DEMO_ORG_ID, demoNow);
  const { kpis } = snapshot;
  const firstName = DEMO_STAFF_NAME.split(" ")[0];

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">Good afternoon, {firstName}</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Where {snapshot.organization.name} stands today, and who needs you next.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6">
        <StatTile label="Active clients" value={String(kpis.activeClients)} />
        <StatTile label="Open leads" value={String(kpis.openLeads)} />
        <StatTile
          label="At risk / dormant"
          value={String(kpis.atRiskOrDormant)}
          hint="engagement follow-up"
        />
        <StatTile
          label="Docs to review"
          value={String(kpis.documentsAwaitingReview)}
          hint="uploaded or in review"
        />
        <StatTile
          label="Appointments"
          value={String(kpis.appointmentsNext7Days)}
          hint="next 7 days"
        />
        <StatTile
          label="July actions done"
          value={fmtPct(kpis.monthlyActionCompletionPct)}
          hint="across action plans"
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard
            title="Lifecycle stage distribution"
            subtitle="Assessed clients per stage — versioned rules, not model output"
          >
            <StageDistribution distribution={snapshot.stageDistribution} />
          </SectionCard>

          <SectionCard title="Pipeline" subtitle="Everyone in the book, by pipeline status">
            <dl className="grid grid-cols-2 gap-x-8 gap-y-3 sm:grid-cols-3">
              {snapshot.pipeline.map(({ status, count }) => (
                <div key={status} className="flex items-baseline justify-between border-b border-line/60 pb-2">
                  <dt className="text-sm text-ink-soft">{PIPELINE_LABELS[status]}</dt>
                  <dd className="font-display text-xl text-ink">{count}</dd>
                </div>
              ))}
            </dl>
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard title="Needs attention" subtitle="Ranked by retention risk">
            {snapshot.needsAttention.length === 0 ? (
              <EmptyState message="Nothing needs attention right now." />
            ) : (
              <ul className="space-y-3">
                {snapshot.needsAttention.map((item) => (
                  <li key={`${item.clientId}-${item.kind}-${item.detail}`}>
                    <Link
                      href={`/clients/${item.clientId}`}
                      className="group block rounded-md border border-line bg-ivory px-3.5 py-2.5 transition-colors hover:border-gold/60"
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-ink group-hover:text-gold-deep">
                          {item.clientName}
                        </span>
                        <span className="text-[10px] font-medium uppercase tracking-wider text-ink-faint">
                          {item.kind}
                        </span>
                      </span>
                      <span className="mt-0.5 block text-xs text-ink-soft">{item.detail}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>

          <SectionCard title="Upcoming appointments">
            {snapshot.upcomingAppointments.length === 0 ? (
              <EmptyState message="No upcoming appointments." />
            ) : (
              <ul className="space-y-3">
                {snapshot.upcomingAppointments.map((u) => (
                  <li key={u.appointment.id} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <Link
                        href={`/clients/${u.clientId}`}
                        className="text-sm font-medium text-ink hover:text-emerald"
                      >
                        {u.clientName}
                      </Link>
                      <p className="truncate text-xs text-ink-soft">{u.appointment.purpose}</p>
                    </div>
                    <p className="shrink-0 text-right text-xs text-ink-faint">
                      {fmtDateTime(u.appointment.scheduledAt)}
                    </p>
                  </li>
                ))}
              </ul>
            )}
          </SectionCard>
        </div>
      </div>

      <div aria-hidden className="pb-2 text-center text-[11px] text-ink-faint">
        Engagement legend:{" "}
        <span className="inline-flex gap-3 align-middle">
          <EngagementBadge status="active" />
          <EngagementBadge status="cooling" />
          <EngagementBadge status="at_risk" />
          <EngagementBadge status="dormant" />
        </span>
      </div>
    </div>
  );
}
