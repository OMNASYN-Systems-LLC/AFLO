import { LIFECYCLE_STAGES, type LifecycleStage, type StageCount } from "@aflo/shared";
import { STAGE_LABELS } from "@/lib/format";

/**
 * Stage distribution — single ordinal series, one hue, direct value labels,
 * 4px rounded data-ends anchored to the baseline (dataviz mark spec).
 */
export function StageDistribution({ distribution }: { distribution: StageCount[] }) {
  const max = Math.max(1, ...distribution.map((d) => d.count));
  return (
    <div className="space-y-2.5" role="img" aria-label="Clients per lifecycle stage">
      {distribution.map(({ stage, count }) => (
        <div key={stage} className="group flex items-center gap-3" title={`${STAGE_LABELS[stage]}: ${count}`}>
          <span className="w-36 shrink-0 text-right text-xs text-ink-soft">
            {STAGE_LABELS[stage]}
          </span>
          <div className="relative h-4 flex-1">
            {count > 0 ? (
              <div
                className="h-full rounded-r-[4px] bg-mark-emerald transition-opacity group-hover:opacity-80"
                style={{ width: `${(count / max) * 100}%` }}
              />
            ) : (
              <div className="mt-[7px] h-px w-2 bg-line" />
            )}
          </div>
          <span className={`w-6 text-xs tabular-nums ${count > 0 ? "font-medium text-ink" : "text-ink-faint"}`}>
            {count}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Compact position indicator for the eight-stage lifecycle: filled through
 * the current stage, labeled by the caller — segments carry tooltips.
 */
export function StageTrack({ current }: { current: LifecycleStage }) {
  const currentIdx = LIFECYCLE_STAGES.indexOf(current);
  return (
    <div className="flex items-center gap-1" aria-label={`Stage ${currentIdx + 1} of ${LIFECYCLE_STAGES.length}: ${STAGE_LABELS[current]}`}>
      {LIFECYCLE_STAGES.map((stage, i) => (
        <span
          key={stage}
          title={STAGE_LABELS[stage]}
          className={`h-1.5 flex-1 rounded-full ${
            i < currentIdx ? "bg-emerald" : i === currentIdx ? "bg-gold" : "bg-sand"
          }`}
        />
      ))}
    </div>
  );
}
