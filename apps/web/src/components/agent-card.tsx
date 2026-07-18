import type { AgentEnvelope } from "@aflo/shared";
import { AGENT_LABELS, fmtDate, fmtPct, REASON_CODE_LABELS } from "@/lib/format";
import { Badge, ReviewStatusBadge } from "./badges";

/**
 * Renders one typed agent envelope. Drafts and proposals only — the UI
 * copy makes explicit that nothing here alters financial facts.
 */
export function AgentSuggestionCard({ envelope }: { envelope: AgentEnvelope }) {
  return (
    <article className="rounded-md border border-line bg-ivory p-4">
      <header className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <span className="text-sm font-semibold text-ink">{AGENT_LABELS[envelope.agentName]}</span>
          <Confidence value={envelope.confidence} />
        </div>
        <ReviewStatusBadge status={envelope.reviewStatus} />
      </header>

      {envelope.prohibitedActionsDetected.length > 0 ? (
        <p className="mt-3 rounded border border-status-risk/40 bg-status-risk-tint px-3 py-2 text-xs font-medium text-status-risk">
          Prohibited action detected ({envelope.prohibitedActionsDetected.join(", ")}) — run halted and audited.
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {envelope.proposedActions.map((rec) => (
          <div key={rec.id}>
            <div className="flex items-center gap-2">
              <p className="text-sm font-medium text-ink">{rec.summary}</p>
              <Badge
                tone={rec.impact === "high" ? "risk" : rec.impact === "medium" ? "warn" : "neutral"}
                label={`${rec.impact} impact`}
              />
            </div>
            <p className="mt-1 text-sm leading-relaxed text-ink-soft">{rec.rationale}</p>
          </div>
        ))}
      </div>

      {envelope.reasonCodes.length > 0 ? (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {envelope.reasonCodes.map((code) => (
            <li
              key={code}
              title={code}
              className="rounded bg-sand px-1.5 py-0.5 font-mono text-[11px] text-ink-soft"
            >
              {/* Envelope reason codes are free strings from the model run; fall back to the raw token. */}
              {(REASON_CODE_LABELS as Record<string, string | undefined>)[code] ?? code}
            </li>
          ))}
        </ul>
      ) : null}

      <footer className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/70 pt-2.5 text-[11px] text-ink-faint">
        <span>
          Facts: <span className="font-mono">{envelope.factsUsed.join(", ")}</span>
        </span>
        <span>
          Rules: <span className="font-mono">{envelope.ruleVersionsUsed.join(", ")}</span>
        </span>
        <span>{fmtDate(envelope.createdAt)}</span>
      </footer>
    </article>
  );
}

function Confidence({ value }: { value: number }) {
  const pct = Math.round(value * 100);
  return (
    <span className="flex items-center gap-1.5" title={`Model confidence ${fmtPct(pct)}`}>
      <span className="h-1 w-16 overflow-hidden rounded-full bg-sand">
        <span className="block h-full rounded-full bg-mark-emerald" style={{ width: `${pct}%` }} />
      </span>
      <span className="text-[11px] tabular-nums text-ink-faint">{fmtPct(pct)}</span>
    </span>
  );
}
