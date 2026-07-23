import {
  fullName,
  REVIEW_DECISION_REASON_CODES,
  REVIEW_DECISIONS,
} from "@aflo/shared";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ReviewItemStateBadge, RiskBadge } from "@/components/badges";
import { EmptyState, SectionCard } from "@/components/ui";
import { DEMO_ORG_ID, store } from "@/lib/data";
import { fmtDate, fmtDateTime, STAFF_ROLE_LABELS, STAGE_LABELS } from "@/lib/format";
import { currentArtifactStateFor } from "@/lib/review-artifacts";
import {
  REVIEW_ARTIFACT_TYPE_LABELS,
  REVIEW_DECISION_LABELS,
  REVIEW_DECISION_PAST_LABELS,
  REVIEWER_ROLE_LABELS,
  shortDigest,
} from "@/lib/review-format";
import { AssignForm, DecisionForm, PublishControl } from "./review-controls";

export const metadata = { title: "Review item" };

/**
 * Human Review Center — item detail. Full provenance (references, versions,
 * and digests only — never artifact bodies), the append-only decision
 * history, and the review actions. Every action calls a store method and
 * renders the store's result verbatim; authorization lives ONLY in the store
 * (ADR-0045). The client-visibility panel shows exactly what
 * `clientPublishedReviews` would serve, making the client-safe boundary
 * visible to staff.
 */

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="border-b border-line/60 pb-2">
      <dt className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">{label}</dt>
      <dd className="mt-0.5 text-sm text-ink">{children}</dd>
    </div>
  );
}

function Digest({ value }: { value: string }) {
  return (
    <code className="font-mono text-xs text-ink-soft" title={value}>
      {shortDigest(value)}
    </code>
  );
}

export default async function ReviewItemPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const item = store.staffReviewQueue(DEMO_ORG_ID).find((i) => i.id === id);
  if (!item) notFound();

  const decisions = store.reviewDecisionsFor(DEMO_ORG_ID, item.id);
  const current = currentArtifactStateFor(item);
  const clientView = item.clientId
    ? store
        .clientPublishedReviews(DEMO_ORG_ID, item.clientId)
        .find((v) => v.reviewItemId === item.id) ?? null
    : null;

  const staff = store.database().staff;
  const staffNameById = new Map(staff.map((s) => [s.id, s.name] as const));
  const clientName = item.clientId
    ? (() => {
        const record = store.database().clients.find((c) => c.id === item.clientId);
        return record ? fullName(record) : item.clientId;
      })()
    : null;

  const decisionOptions = REVIEW_DECISIONS.map((d) => ({
    decision: d,
    label: REVIEW_DECISION_LABELS[d],
  }));
  const reasonOptions = Object.entries(REVIEW_DECISION_REASON_CODES).map(([code, entry]) => ({
    code,
    description: entry.description,
    decisions: [...entry.decisions],
  }));
  const staffOptions = staff.map((s) => ({
    id: s.id,
    label: `${s.name} — ${STAFF_ROLE_LABELS[s.role]}`,
  }));

  const isOpen = item.state === "draft" || item.state === "awaiting_review";
  const reasonDescription = (code: string): string | null =>
    (REVIEW_DECISION_REASON_CODES as Record<string, { description: string }>)[code]?.description ??
    null;

  return (
    <div className="space-y-6">
      <Link href="/reviews" className="text-xs font-medium text-ink-soft hover:text-emerald">
        ← Review Center
      </Link>

      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl text-ink">
            {REVIEW_ARTIFACT_TYPE_LABELS[item.artifactType]}
          </h1>
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            <ReviewItemStateBadge state={item.state} />
            <RiskBadge risk={item.riskClassification} />
            <span className="text-xs text-ink-faint">
              Requires {REVIEWER_ROLE_LABELS[item.requiredReviewerRole]}
            </span>
          </div>
          <p className="mt-2 font-mono text-[11px] text-ink-faint">{item.id}</p>
        </div>
        {clientName ? (
          <div className="rounded-lg border border-line bg-card px-5 py-3.5 text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              Client
            </p>
            <Link
              href={`/clients/${item.clientId}`}
              className="mt-1 block text-sm font-medium text-ink hover:text-emerald"
            >
              {clientName}
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-line bg-card px-5 py-3.5 text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              Scope
            </p>
            <p className="mt-1 text-sm text-ink">Organization-level artifact</p>
          </div>
        )}
      </div>

      {current.changedSinceReview ? (
        <p className="rounded-md border-l-4 border-status-risk bg-status-risk-tint px-4 py-2.5 text-sm text-status-risk">
          The artifact has changed since this review captured it (reviewed v{item.artifactVersion},
          current v{current.version}). A prior approval cannot publish changed content — a fresh
          review of the new version is required.
        </p>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-3">
        <div className="space-y-6 xl:col-span-2">
          <SectionCard
            title="Provenance"
            subtitle="References, versions, and digests only — the Review Center never stores artifact bodies"
          >
            <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2">
              <Field label="Artifact">
                <span className="font-mono text-xs">{item.artifactId}</span>
                <span className="mt-0.5 block text-xs text-ink-soft">
                  Reviewed v{item.artifactVersion} · <Digest value={item.artifactDigest} />
                </span>
              </Field>
              <Field label="Current artifact">
                <span className="text-xs text-ink-soft">
                  v{current.version} · <Digest value={current.digest} />
                </span>
                <span
                  className={`mt-0.5 block text-xs ${
                    current.changedSinceReview ? "font-medium text-status-risk" : "text-ink-faint"
                  }`}
                >
                  {current.changedSinceReview ? "Changed since review" : "Unchanged since review"}
                </span>
              </Field>
              <Field label="Workflow type">
                {REVIEW_ARTIFACT_TYPE_LABELS[item.workflowType]}
              </Field>
              <Field label="Confidence">
                {item.confidence ?? "Deterministic — no model confidence"}
              </Field>
              <Field label="AI provenance">
                {item.aiRunId ? (
                  <span className="font-mono text-xs">
                    {item.aiRunId} · {item.aiModel ?? "unknown model"} ·{" "}
                    {item.aiPromptVersion ?? "unknown prompt"}
                  </span>
                ) : (
                  "Manually authored — no AI run"
                )}
              </Field>
              <Field label="Rule versions used">
                {item.ruleVersionsUsed.length > 0 ? (
                  <span className="font-mono text-xs">{item.ruleVersionsUsed.join(", ")}</span>
                ) : (
                  "—"
                )}
              </Field>
              {item.playbookId ? (
                <Field label="Playbook">
                  <span className="font-mono text-xs">
                    {item.playbookId}
                    {item.playbookVersion ? ` @ v${item.playbookVersion}` : ""}
                  </span>
                </Field>
              ) : null}
              <Field label="Author">
                {item.createdByStaffId
                  ? staffNameById.get(item.createdByStaffId) ?? item.createdByStaffId
                  : "System / orchestrator"}
              </Field>
              <Field label="Created">{fmtDateTime(item.createdAt)}</Field>
              <Field label="Submitted">
                {item.submittedAt ? fmtDateTime(item.submittedAt) : "Not yet submitted"}
              </Field>
              {item.previousReviewItemId ? (
                <Field label="Previous review">
                  <Link
                    href={`/reviews/${item.previousReviewItemId}`}
                    className="font-mono text-xs text-emerald hover:text-emerald-deep"
                  >
                    {item.previousReviewItemId}
                  </Link>
                </Field>
              ) : null}
              {item.supersededByReviewItemId ? (
                <Field label="Superseded by">
                  <Link
                    href={`/reviews/${item.supersededByReviewItemId}`}
                    className="font-mono text-xs text-emerald hover:text-emerald-deep"
                  >
                    {item.supersededByReviewItemId}
                  </Link>
                </Field>
              ) : null}
            </dl>

            <div className="mt-5">
              <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                Source facts &amp; freshness
              </h3>
              {item.sourceFactSnapshots.length === 0 ? (
                <p className="mt-1.5 text-sm text-ink-faint">No source-fact snapshots recorded.</p>
              ) : (
                <ul className="mt-1.5 space-y-1">
                  {item.sourceFactSnapshots.map((fact) => (
                    <li key={fact.factId} className="flex items-baseline justify-between gap-3">
                      <span className="font-mono text-xs text-ink">{fact.factId}</span>
                      <span className="shrink-0 text-xs text-ink-soft">
                        as of {fmtDate(fact.asOf)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {item.modificationsDigest.length > 0 ? (
              <div className="mt-5">
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  Recorded modifications — digests only
                </h3>
                <ul className="mt-1.5 space-y-1">
                  {item.modificationsDigest.map((mod) => (
                    <li key={mod.field} className="text-xs text-ink-soft">
                      <span className="font-medium text-ink">{mod.field}</span>:{" "}
                      <Digest value={mod.beforeSha256} /> → <Digest value={mod.afterSha256} />
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </SectionCard>

          <SectionCard
            title="Decision history"
            subtitle="Append-only — structured decisions with reason codes, never overwritten"
          >
            {decisions.length === 0 ? (
              <EmptyState message="No decisions recorded yet." />
            ) : (
              <ol className="space-y-4">
                {decisions.map((d) => (
                  <li key={d.id} className="rounded-md border border-line bg-ivory px-4 py-3">
                    <div className="flex flex-wrap items-baseline justify-between gap-2">
                      <p className="text-sm font-medium text-ink">
                        {REVIEW_DECISION_PAST_LABELS[d.decision]}
                        <span className="ml-2 font-mono text-[11px] text-ink-faint">
                          {d.reasonCode}
                        </span>
                      </p>
                      <p className="text-xs text-ink-faint">{fmtDateTime(d.decidedAt)}</p>
                    </div>
                    {reasonDescription(d.reasonCode) ? (
                      <p className="mt-0.5 text-xs text-ink-soft">
                        {reasonDescription(d.reasonCode)}
                      </p>
                    ) : null}
                    <p className="mt-1.5 text-xs text-ink-soft">
                      By {staffNameById.get(d.decidedByStaffId) ?? d.decidedByStaffId}
                      {d.clientStageAtDecision
                        ? ` · client stage: ${STAGE_LABELS[d.clientStageAtDecision]}`
                        : ""}
                      {d.escalatedToRole
                        ? ` · floor raised to ${REVIEWER_ROLE_LABELS[d.escalatedToRole]}`
                        : ""}
                    </p>
                    {d.editedFields.length > 0 ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        Edited fields: {d.editedFields.join(", ")}
                      </p>
                    ) : null}
                    {d.finalOutputSha256 ? (
                      <p className="mt-1 text-xs text-ink-soft">
                        Final output digest: <Digest value={d.finalOutputSha256} />
                      </p>
                    ) : null}
                    {d.detail ? (
                      <p className="mt-1.5 text-sm italic text-ink-soft">“{d.detail}”</p>
                    ) : null}
                  </li>
                ))}
              </ol>
            )}
          </SectionCard>
        </div>

        <div className="space-y-6">
          <SectionCard
            title="Review actions"
            subtitle="Authorization is decided by the workflow rules — denials render here verbatim"
          >
            <div className="space-y-5">
              <div>
                <h3 className="text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  Assigned reviewer
                </h3>
                <p className="mt-1 text-sm text-ink">
                  {item.assignedReviewerStaffId
                    ? staffNameById.get(item.assignedReviewerStaffId) ??
                      item.assignedReviewerStaffId
                    : "Unassigned — any qualifying reviewer may decide"}
                </p>
                {isOpen ? (
                  <div className="mt-3">
                    <AssignForm
                      reviewItemId={item.id}
                      staffOptions={staffOptions}
                      currentAssigneeId={item.assignedReviewerStaffId}
                    />
                  </div>
                ) : (
                  <p className="mt-1.5 text-xs text-ink-faint">
                    Assignment is only available while an item is open.
                  </p>
                )}
              </div>

              <div className="border-t border-line/70 pt-4">
                {item.state === "awaiting_review" ? (
                  <DecisionForm
                    reviewItemId={item.id}
                    decisionOptions={decisionOptions}
                    reasonOptions={reasonOptions}
                  />
                ) : item.state === "draft" ? (
                  <p className="text-sm text-ink-soft">
                    Still a draft — decisions open once the author submits it into the queue.
                  </p>
                ) : item.state === "approved" ? (
                  <PublishControl
                    reviewItemId={item.id}
                    currentVersionLabel={`current artifact (v${current.version})`}
                  />
                ) : item.state === "published" ? (
                  <p className="text-sm text-ink-soft">
                    Published {item.publishedAt ? fmtDateTime(item.publishedAt) : ""}
                    {item.publishedResultRef ? (
                      <span className="mt-0.5 block font-mono text-xs text-ink-faint">
                        {item.publishedResultRef}
                      </span>
                    ) : null}
                  </p>
                ) : (
                  <p className="text-sm text-ink-soft">
                    This item is {item.state} — a terminal state. A revised attempt is a new
                    linked review item, never a resurrection.
                  </p>
                )}
              </div>
            </div>
          </SectionCard>

          <SectionCard
            title="Client visibility"
            subtitle="Exactly what the client-safe projection serves — nothing more"
          >
            <div data-testid="client-preview">
              {clientView ? (
                <dl className="space-y-2.5">
                  <Field label="Update">
                    {REVIEW_ARTIFACT_TYPE_LABELS[clientView.artifactType]}
                  </Field>
                  <Field label="Reference">
                    <span className="font-mono text-xs">
                      {clientView.publishedResultRef ?? clientView.artifactId}
                    </span>
                  </Field>
                  <Field label="Published">{fmtDateTime(clientView.publishedAt)}</Field>
                  <Field label="Client action">
                    {clientView.clientActionStatus
                      ? clientView.clientActionStatus.replace("_", " ")
                      : "None tracked"}
                  </Field>
                  <Field label="Outcome">
                    {clientView.outcome
                      ? `${clientView.outcome.replace("_", " ")}${
                          clientView.outcomeRecordedAt
                            ? ` · ${fmtDate(clientView.outcomeRecordedAt)}`
                            : ""
                        }`
                      : "Not yet recorded"}
                  </Field>
                </dl>
              ) : (
                <p className="rounded-md border border-dashed border-line bg-ivory px-4 py-5 text-center text-sm text-ink-faint">
                  Not visible to the client — only published items reach the client surface.
                </p>
              )}
            </div>
            <p className="mt-3 text-[11px] text-ink-faint">
              Reviewer identity, confidence, risk class, reason codes, and decision history are
              structurally excluded from the client projection.
            </p>
          </SectionCard>
        </div>
      </div>
    </div>
  );
}
