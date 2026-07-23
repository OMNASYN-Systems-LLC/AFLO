import Link from "next/link";
import { EngagementBadge, KindBadge, StageBadge } from "@/components/badges";
import { DEMO_ORG_ID, clientRepository, demoNow } from "@/lib/data";
import { fmtDate } from "@/lib/format";

export const metadata = { title: "Clients" };

// Render at REQUEST time so every render passes the ADR-0048 demo-runtime
// gate — synthetic data must never be baked into the build (PR #99 M1).
export const dynamic = "force-dynamic";

export default async function ClientsPage() {
  const rows = await clientRepository.list(DEMO_ORG_ID, demoNow);
  const clients = rows.filter((r) => r.kind === "client").length;
  const leads = rows.length - clients;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="font-display text-3xl text-ink">Clients</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {clients} clients and {leads} leads. Stage comes from versioned readiness rules;
          engagement from activity recency.
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-card">
        <table className="w-full min-w-[880px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line text-[11px] font-medium uppercase tracking-[0.12em] text-ink-soft">
              <th className="px-5 py-3">Name</th>
              <th className="px-5 py-3">Type</th>
              <th className="px-5 py-3">Pipeline</th>
              <th className="px-5 py-3">Stage</th>
              <th className="px-5 py-3">Primary goal</th>
              <th className="px-5 py-3">Engagement</th>
              <th className="px-5 py-3">Next appt</th>
              <th className="px-5 py-3">Advisor</th>
            </tr>
          </thead>
          <tbody className="text-sm">
            {rows.map((row) => (
              <tr key={row.id} className="group border-b border-line/60 last:border-b-0 hover:bg-ivory">
                <td className="px-5 py-3.5">
                  <Link
                    href={`/clients/${row.id}`}
                    className="font-medium text-ink group-hover:text-emerald"
                  >
                    {row.name}
                  </Link>
                </td>
                <td className="px-5 py-3.5">
                  <KindBadge kind={row.kind} />
                </td>
                <td className="px-5 py-3.5 text-ink-soft">
                  {row.pipelineStageLabel}
                  {row.clientStatus === "paused" ? (
                    <span className="ml-1.5 text-xs text-ink-faint">(paused)</span>
                  ) : null}
                </td>
                <td className="px-5 py-3.5">
                  <StageBadge stage={row.stage} />
                </td>
                <td className="max-w-[220px] truncate px-5 py-3.5 text-ink-soft" title={row.primaryGoal ?? undefined}>
                  {row.primaryGoal ?? <span className="text-ink-faint">—</span>}
                </td>
                <td className="px-5 py-3.5">
                  <span className="flex items-center gap-2">
                    <EngagementBadge status={row.engagement} />
                    <span className="text-xs tabular-nums text-ink-faint">
                      {row.daysSinceLastActivity}d
                    </span>
                  </span>
                </td>
                <td className="px-5 py-3.5 text-ink-soft">
                  {row.nextAppointmentAt ? (
                    fmtDate(row.nextAppointmentAt)
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-ink-soft">{row.assignedStaffName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
