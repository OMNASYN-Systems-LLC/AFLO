import { nextRequiredStage } from "@aflo/shared";
import Link from "next/link";
import { EngagementBadge } from "@/components/badges";
import { EmptyState, SectionCard } from "@/components/ui";
import { clientRepository, DEMO_ORG_ID, demoNow, store } from "@/lib/data";
import { fmtDateTime } from "@/lib/format";
import { advanceLeadAction } from "./actions";

export const metadata = { title: "Lead Pipeline" };
export const dynamic = "force-dynamic";

/**
 * Staff lead-conversion workspace: every lead shown at its pipeline stage
 * with only rule-legal actions offered. The deterministic pipeline rules
 * (pipeline.v1.0.0) are the sole authority on what moves are possible;
 * denied attempts would be audited, but the UI never offers them.
 */
export default async function LeadsPage() {
  const rows = await clientRepository.list(DEMO_ORG_ID, demoNow);
  const leads = rows.filter((r) => r.kind === "lead");
  const pipeline = store.pipelineFor(DEMO_ORG_ID);
  const audit = store.auditFor(DEMO_ORG_ID).slice(-8).reverse();
  const stages = pipeline ? [...pipeline.stages].sort((a, b) => a.order - b.order) : [];
  const nonTerminal = stages.filter((s) => !s.terminal);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">Lead Pipeline</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          {leads.length} open lead{leads.length === 1 ? "" : "s"}. Moves follow the pipeline rules —
          required stages are never skipped, and reversals are always recorded.
        </p>
      </div>

      <div className="space-y-6">
        {nonTerminal.map((stage) => {
          const atStage = leads.filter((l) => l.pipelineStageId === stage.id);
          return (
            <SectionCard
              key={stage.id}
              title={stage.label}
              subtitle={stage.required ? "Required stage" : "Optional stage"}
              action={
                <span className="font-display text-xl text-ink" aria-label={`${atStage.length} leads`}>
                  {atStage.length}
                </span>
              }
            >
              {atStage.length === 0 ? (
                <EmptyState message="No leads at this stage." />
              ) : (
                <ul className="divide-y divide-line/60">
                  {atStage.map((leadRow) => {
                    const next = pipeline ? nextRequiredStage(pipeline, leadRow.pipelineStageId) : null;
                    const prevRequired = pipeline
                      ? [...stages]
                          .reverse()
                          .find((s) => s.order < stage.order && s.required) ?? null
                      : null;
                    return (
                      <li key={leadRow.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
                        <div className="min-w-0">
                          <Link
                            href={`/clients/${leadRow.id}`}
                            className="text-sm font-medium text-ink hover:text-emerald"
                          >
                            {leadRow.name}
                          </Link>
                          <p className="mt-0.5 flex items-center gap-2 text-xs text-ink-faint">
                            <EngagementBadge status={leadRow.engagement} />
                            <span>{leadRow.daysSinceLastActivity}d since activity</span>
                            <span>· {leadRow.assignedStaffName}</span>
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {prevRequired ? (
                            <form action={advanceLeadAction.bind(null, leadRow.id, prevRequired.id, true)}>
                              <button
                                type="submit"
                                className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-gold/60 hover:text-gold-deep"
                                title={`Reverse to ${prevRequired.label} (recorded as a correction)`}
                              >
                                ← {prevRequired.label}
                              </button>
                            </form>
                          ) : null}
                          {next ? (
                            <form action={advanceLeadAction.bind(null, leadRow.id, next.id, false)}>
                              <button
                                type="submit"
                                className="rounded-md bg-emerald px-3.5 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                              >
                                {next.terminal ? "Activate as client" : `Advance to ${next.label}`}
                              </button>
                            </form>
                          ) : null}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </SectionCard>
          );
        })}
      </div>

      <SectionCard
        title="Recent pipeline activity"
        subtitle="Append-only audit trail — reversals and denied moves included"
      >
        {audit.length === 0 ? (
          <EmptyState message="No pipeline activity yet this session." />
        ) : (
          <ul className="space-y-2">
            {audit.map((entry) => (
              <li key={entry.id} className="flex flex-wrap items-baseline justify-between gap-2 text-sm">
                <span className="text-ink-soft">
                  <span className="font-medium text-ink">{entry.action}</span> · {entry.targetId} ·{" "}
                  {entry.detail}
                </span>
                <span className="font-mono text-[11px] text-ink-faint">
                  {entry.reasonCode} · {fmtDateTime(entry.occurredAt)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </SectionCard>
    </div>
  );
}
