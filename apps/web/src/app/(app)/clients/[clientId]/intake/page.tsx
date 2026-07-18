import { fullName, intakeCompleteness } from "@aflo/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { IntakeStatusBadge, KindBadge, PipelineBadge } from "@/components/badges";
import { EmptyState, ProgressBar, SectionCard } from "@/components/ui";
import { DEMO_ORG_ID, clientRepository, demoNow, store } from "@/lib/data";
import { fmtDate, fmtDateTime } from "@/lib/format";
import { completeIntakeAction, completeIntakeSectionAction } from "./actions";

export const metadata = { title: "Intake" };
export const dynamic = "force-dynamic";

/**
 * Staff intake workspace: the structured section checklist for one client,
 * with only rule-legal actions offered. The deterministic intake rules
 * (intake.v1.0.0) are the sole authority on completion — the "Complete
 * intake" action appears only once every required section is complete, and
 * completing it advances a lead to the intake_completed pipeline stage in
 * the same audited operation.
 */
export default async function IntakePage({
  params,
}: {
  params: Promise<{ clientId: string }>;
}) {
  const { clientId } = await params;
  const detail = await clientRepository.getDetail(DEMO_ORG_ID, clientId, demoNow);
  if (!detail) notFound();

  const name = fullName(detail.record);
  const definition = store.intakeDefinitionFor(DEMO_ORG_ID);
  const intake = store.intakeFor(DEMO_ORG_ID, clientId);
  const completeness =
    definition && intake ? intakeCompleteness(definition, intake.completedSectionIds) : null;
  const sections = definition ? [...definition.sections].sort((a, b) => a.order - b.order) : [];
  const sectionLabel = new Map(sections.map((s) => [s.id, s.label]));
  const audit = store
    .auditFor(DEMO_ORG_ID)
    .filter((entry) => entry.targetId === clientId)
    .slice(-8)
    .reverse();

  return (
    <div className="space-y-8">
      <div>
        <Link
          href={`/clients/${clientId}`}
          className="text-xs font-medium text-ink-soft hover:text-emerald"
        >
          ← {name}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="font-display text-3xl text-ink">Intake — {name}</h1>
        </div>
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <KindBadge kind={detail.record.kind} />
          <PipelineBadge label={detail.pipelineStageLabel} />
          {intake ? <IntakeStatusBadge status={intake.status} /> : null}
        </div>
      </div>

      {!intake || !definition || !completeness ? (
        <SectionCard title="Intake not started">
          <EmptyState message="The structured intake opens automatically when this lead advances to the Intake started stage." />
          <p className="mt-3 text-sm text-ink-soft">
            Move the lead forward from the{" "}
            <Link href="/leads" className="font-medium text-emerald hover:text-emerald-deep">
              Lead Pipeline
            </Link>
            .
          </p>
        </SectionCard>
      ) : (
        <div className="grid gap-6 xl:grid-cols-3">
          <div className="space-y-6 xl:col-span-2">
            <SectionCard
              title="Sections"
              subtitle={`Started ${fmtDate(intake.startedAt)} · rule ${completeness.ruleVersion}`}
              action={
                <span className="text-sm font-medium text-ink-soft">
                  {completeness.completedRequiredCount} of {completeness.requiredCount} required
                </span>
              }
            >
              <div className="mb-4">
                <ProgressBar
                  pct={(completeness.completedRequiredCount / completeness.requiredCount) * 100}
                  label={`${completeness.completedRequiredCount}/${completeness.requiredCount}`}
                />
              </div>
              <ul className="divide-y divide-line/60">
                {sections.map((section) => {
                  const done = intake.completedSectionIds.includes(section.id);
                  return (
                    <li
                      key={section.id}
                      className="flex flex-wrap items-center justify-between gap-3 py-3"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <SectionMarker done={done} />
                        <div className="min-w-0">
                          <p className={`text-sm font-medium ${done ? "text-ink-faint" : "text-ink"}`}>
                            {section.label}
                          </p>
                          <p className="text-[11px] text-ink-faint">
                            {section.required ? "Required" : "Optional"}
                          </p>
                        </div>
                      </div>
                      {!done && intake.status === "in_progress" ? (
                        <form action={completeIntakeSectionAction.bind(null, clientId, section.id)}>
                          <button
                            type="submit"
                            className="rounded-md border border-line px-3 py-1.5 text-xs text-ink-soft transition-colors hover:border-emerald/60 hover:text-emerald-deep"
                          >
                            Mark complete
                          </button>
                        </form>
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </SectionCard>

            <SectionCard
              title="Complete intake"
              subtitle="Only the deterministic completeness rules can declare the intake complete"
            >
              {intake.status === "completed" ? (
                <p className="text-sm text-ink-soft">
                  Intake completed {intake.completedAt ? fmtDateTime(intake.completedAt) : ""} — every
                  required section verified by rule {completeness.ruleVersion}.
                </p>
              ) : completeness.complete ? (
                <form action={completeIntakeAction.bind(null, clientId)}>
                  <button
                    type="submit"
                    className="rounded-md bg-emerald px-4 py-2 text-sm font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
                  >
                    Complete intake
                  </button>
                  <p className="mt-2.5 text-xs text-ink-faint">
                    Completing the intake records the audit event and, for a lead, advances the
                    pipeline to Intake completed in the same operation.
                  </p>
                </form>
              ) : (
                <div>
                  <p className="text-sm text-ink-soft">
                    Blocked by rule {completeness.ruleVersion} ({completeness.reasonCode}) — still
                    missing:
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {completeness.missingRequiredSectionIds.map((id) => (
                      <li key={id} className="rounded bg-sand px-2 py-1 text-xs text-ink-soft">
                        {sectionLabel.get(id) ?? id}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </SectionCard>
          </div>

          <div className="space-y-6">
            <SectionCard
              title="Intake activity"
              subtitle="Append-only audit trail for this client — denials included"
            >
              {audit.length === 0 ? (
                <EmptyState message="No intake activity yet this session." />
              ) : (
                <ul className="space-y-2.5">
                  {audit.map((entry) => (
                    <li key={entry.id} className="text-sm">
                      <p className="text-ink-soft">
                        <span className="font-medium text-ink">{entry.action}</span> · {entry.detail}
                      </p>
                      <p className="font-mono text-[11px] text-ink-faint">
                        {entry.reasonCode} · {fmtDateTime(entry.occurredAt)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </SectionCard>
          </div>
        </div>
      )}
    </div>
  );
}

function SectionMarker({ done }: { done: boolean }) {
  return (
    <span
      className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${
        done ? "bg-status-good text-ivory-ink" : "border-2 border-line bg-ivory"
      }`}
    >
      {done ? "✓" : ""}
    </span>
  );
}
