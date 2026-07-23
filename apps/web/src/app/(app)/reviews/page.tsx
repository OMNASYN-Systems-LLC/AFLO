import {
  fullName,
  REVIEW_ARTIFACT_TYPES,
  REVIEW_ITEM_STATES,
  REVIEW_RISK_CLASSES,
  type ReviewArtifactType,
  type ReviewItem,
  type ReviewItemState,
  type ReviewRiskClass,
} from "@aflo/shared";
import Link from "next/link";
import { ReviewItemStateBadge, RiskBadge } from "@/components/badges";
import { EmptyState, SectionCard, StatTile } from "@/components/ui";
import { DEMO_ORG_ID, demoNow, store } from "@/lib/data";
import {
  fmtRateOrDash,
  fmtReviewMinutes,
  REVIEW_ARTIFACT_TYPE_LABELS,
  REVIEW_STATE_LABELS,
  REVIEW_RISK_LABELS,
  REVIEWER_ROLE_LABELS,
} from "@/lib/review-format";

export const metadata = { title: "Review Center" };

/**
 * Human Review Center — queue index. Pure projection of the store: the ten
 * founder-directed artifact-type queues, counts by state and risk, filters,
 * and the honest analytics strip (null denominators render "—", never 0%).
 * Every workflow action lives on the item detail page; nothing here decides
 * anything (ADR-0045).
 */

function parseParam<T extends string>(value: string | undefined, valid: readonly T[]): T | undefined {
  return value !== undefined && (valid as readonly string[]).includes(value) ? (value as T) : undefined;
}

/** Whole days between an ISO instant and the pinned demo clock, floored at 0. */
function ageLabel(iso: string | null): string {
  if (!iso) return "—";
  const days = Math.floor((demoNow.getTime() - Date.parse(iso)) / 86_400_000);
  return days <= 0 ? "today" : `${days}d ago`;
}

export default async function ReviewsPage({
  searchParams,
}: {
  searchParams: Promise<{ state?: string; type?: string; risk?: string }>;
}) {
  const params = await searchParams;
  const stateFilter = parseParam<ReviewItemState>(params.state, REVIEW_ITEM_STATES);
  const typeFilter = parseParam<ReviewArtifactType>(params.type, REVIEW_ARTIFACT_TYPES);
  const riskFilter = parseParam<ReviewRiskClass>(params.risk, REVIEW_RISK_CLASSES);
  const hasFilters = stateFilter !== undefined || typeFilter !== undefined || riskFilter !== undefined;

  const allItems = store.staffReviewQueue(DEMO_ORG_ID);
  const filtered = store
    .staffReviewQueue(DEMO_ORG_ID, { state: stateFilter, artifactType: typeFilter })
    .filter((item) => riskFilter === undefined || item.riskClassification === riskFilter);
  const metrics = store.reviewMetrics(DEMO_ORG_ID);

  const clientNameById = new Map(
    store.database().clients.map((c) => [c.id, fullName(c)] as const),
  );
  const staffNameById = new Map(store.database().staff.map((s) => [s.id, s.name] as const));

  const byType = new Map<ReviewArtifactType, ReviewItem[]>(
    REVIEW_ARTIFACT_TYPES.map((t) => [t, []]),
  );
  for (const item of allItems) byType.get(item.artifactType)?.push(item);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-display text-3xl text-ink">Review Center</h1>
        <p className="mt-1.5 text-sm text-ink-soft">
          Human review before anything drafted in ΛFLO reaches a client — every queue, every
          decision, and its provenance.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3" data-testid="review-metrics">
        <StatTile
          label="Awaiting review"
          value={String(metrics.awaitingReviewCount)}
          hint="items currently in the queue"
        />
        <StatTile
          label="Median review time"
          value={fmtReviewMinutes(metrics.overall.medianReviewMinutes)}
          hint={
            metrics.overall.total === 0
              ? "no decisions yet"
              : `submission → decision, over ${metrics.overall.total} decisions`
          }
        />
        <StatTile
          label="Approval rate"
          value={fmtRateOrDash(metrics.overall.approvalRate)}
          hint={
            metrics.overall.total === 0
              ? "no decisions yet"
              : `approved of ${metrics.overall.total} decisions`
          }
        />
      </div>

      <SectionCard
        title="Queues"
        subtitle="The ten reviewable artifact types — counts by state and risk"
      >
        <ul className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {REVIEW_ARTIFACT_TYPES.map((type) => {
            const items = byType.get(type) ?? [];
            const stateCounts = REVIEW_ITEM_STATES.map(
              (s) => [s, items.filter((i) => i.state === s).length] as const,
            ).filter(([, n]) => n > 0);
            const riskCounts = REVIEW_RISK_CLASSES.map(
              (r) => [r, items.filter((i) => i.riskClassification === r).length] as const,
            ).filter(([, n]) => n > 0);
            return (
              <li key={type} className="rounded-md border border-line bg-ivory px-3.5 py-3">
                <Link
                  href={`/reviews?type=${type}`}
                  className="text-sm font-medium text-ink hover:text-emerald"
                >
                  {REVIEW_ARTIFACT_TYPE_LABELS[type]}
                </Link>
                <p className="mt-1 font-display text-2xl leading-none text-ink">{items.length}</p>
                <p className="mt-1.5 text-[11px] text-ink-soft">
                  {stateCounts.length === 0
                    ? "No items"
                    : stateCounts.map(([s, n]) => `${REVIEW_STATE_LABELS[s]} ${n}`).join(" · ")}
                </p>
                {riskCounts.length > 0 ? (
                  <p className="mt-0.5 text-[11px] text-ink-faint">
                    {riskCounts.map(([r, n]) => `${REVIEW_RISK_LABELS[r]} ${n}`).join(" · ")}
                  </p>
                ) : null}
              </li>
            );
          })}
        </ul>
      </SectionCard>

      <SectionCard
        title="Queue items"
        subtitle="Newest first — open an item for provenance, decisions, and publication"
        action={
          hasFilters ? (
            <Link href="/reviews" className="text-xs font-medium text-ink-soft hover:text-emerald">
              Clear filters
            </Link>
          ) : undefined
        }
      >
        <form method="get" className="mb-5 flex flex-wrap items-end gap-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              State
            </span>
            <select
              name="state"
              defaultValue={stateFilter ?? ""}
              className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
            >
              <option value="">All states</option>
              {REVIEW_ITEM_STATES.map((s) => (
                <option key={s} value={s}>
                  {REVIEW_STATE_LABELS[s]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              Queue
            </span>
            <select
              name="type"
              defaultValue={typeFilter ?? ""}
              className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
            >
              <option value="">All queues</option>
              {REVIEW_ARTIFACT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {REVIEW_ARTIFACT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
              Risk
            </span>
            <select
              name="risk"
              defaultValue={riskFilter ?? ""}
              className="rounded-md border border-line bg-card px-2 py-1.5 text-sm text-ink"
            >
              <option value="">All risk classes</option>
              {REVIEW_RISK_CLASSES.map((r) => (
                <option key={r} value={r}>
                  {REVIEW_RISK_LABELS[r]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="submit"
            className="rounded-md bg-emerald px-3.5 py-1.5 text-xs font-medium text-ivory-ink transition-colors hover:bg-emerald-deep"
          >
            Apply filters
          </button>
        </form>

        {filtered.length === 0 ? (
          <EmptyState message="No review items match the current filters." />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-sm">
              <thead>
                <tr className="border-b border-line text-[11px] font-medium uppercase tracking-[0.14em] text-ink-soft">
                  <th scope="col" className="py-2 pr-4">Item</th>
                  <th scope="col" className="py-2 pr-4">Client</th>
                  <th scope="col" className="py-2 pr-4">Risk</th>
                  <th scope="col" className="py-2 pr-4">State</th>
                  <th scope="col" className="py-2 pr-4">Required reviewer</th>
                  <th scope="col" className="py-2 pr-4">Assigned</th>
                  <th scope="col" className="py-2">Submitted</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => (
                  <tr key={item.id} className="border-b border-line/60 align-top">
                    <td className="py-3 pr-4">
                      <Link
                        href={`/reviews/${item.id}`}
                        className="font-medium text-ink hover:text-emerald"
                      >
                        {REVIEW_ARTIFACT_TYPE_LABELS[item.artifactType]}
                      </Link>
                      <p className="mt-0.5 font-mono text-[11px] text-ink-faint">
                        {item.artifactId} · v{item.artifactVersion}
                      </p>
                    </td>
                    <td className="py-3 pr-4 text-ink-soft">
                      {item.clientId ? (
                        <Link href={`/clients/${item.clientId}`} className="hover:text-emerald">
                          {clientNameById.get(item.clientId) ?? item.clientId}
                        </Link>
                      ) : (
                        "Org-level"
                      )}
                    </td>
                    <td className="py-3 pr-4">
                      <RiskBadge risk={item.riskClassification} />
                    </td>
                    <td className="py-3 pr-4">
                      <ReviewItemStateBadge state={item.state} />
                    </td>
                    <td className="py-3 pr-4 text-ink-soft">
                      {REVIEWER_ROLE_LABELS[item.requiredReviewerRole]}
                    </td>
                    <td className="py-3 pr-4 text-ink-soft">
                      {item.assignedReviewerStaffId
                        ? staffNameById.get(item.assignedReviewerStaffId) ??
                          item.assignedReviewerStaffId
                        : "Unassigned"}
                    </td>
                    <td className="py-3 text-ink-soft">
                      {ageLabel(item.submittedAt)}
                      {item.state === "deferred" ? (
                        <span className="block text-[11px] text-ink-faint">
                          deferred {ageLabel(item.reviewedAt)}
                        </span>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </SectionCard>
    </div>
  );
}
