/**
 * Deterministic normalization of a credit report into the readiness-relevant
 * facts the deterministic rules consume (credit-data.v1.0.0).
 *
 * This is the seam between the provider-neutral model and the rules kernel:
 * pure aggregation, no probabilistic inference, no bureau-specific logic, and
 * no AFLO stage decision (that stays in @aflo/rules). Everything here is
 * reproducible from the report alone.
 */

import type { CreditScoreModel, NormalizedCreditReport } from "./model";

/** Trailing window (days) used to count recent hard inquiries. */
const HARD_INQUIRY_WINDOW_DAYS = 365;

export interface CreditFacts {
  /** The primary (first-listed) score value, or null when none reported. */
  primaryScore: number | null;
  primaryScoreModel: CreditScoreModel | null;
  revolvingBalanceCents: number;
  revolvingLimitCents: number;
  /** Reported revolving utilization %, or null when no revolving limit exists. */
  utilizationPct: number | null;
  openTradelines: number;
  derogatoryMarks: number;
  hardInquiriesTrailingYear: number;
  onTimePaymentRate: number;
}

function daysBetween(fromIso: string, to: Date): number {
  return (to.getTime() - Date.parse(fromIso)) / (1000 * 60 * 60 * 24);
}

/**
 * Aggregate a normalized report into deterministic credit facts. `now` anchors
 * the inquiry window so the result is reproducible. Utilization is computed
 * only from OPEN revolving lines with a limit; a zero total limit yields null
 * (no meaningful ratio) rather than a divide-by-zero.
 */
export function summarizeCreditReport(report: NormalizedCreditReport, now: Date): CreditFacts {
  const openRevolving = report.tradelines.filter(
    (t) => t.type === "revolving" && t.status === "open",
  );
  const revolvingBalanceCents = openRevolving.reduce((sum, t) => sum + t.balanceCents, 0);
  const revolvingLimitCents = openRevolving.reduce((sum, t) => sum + (t.creditLimitCents ?? 0), 0);
  const utilizationPct =
    revolvingLimitCents > 0
      ? Math.round((revolvingBalanceCents / revolvingLimitCents) * 1000) / 10
      : null;

  const openTradelines = report.tradelines.filter((t) => t.status === "open").length;
  const derogatoryMarks = report.tradelines.filter((t) => t.isDerogatory).length;
  const hardInquiriesTrailingYear = report.inquiries.filter(
    (i) => i.type === "hard" && daysBetween(i.occurredOn, now) <= HARD_INQUIRY_WINDOW_DAYS,
  ).length;

  const primary = report.scores[0] ?? null;

  return {
    primaryScore: primary?.value ?? null,
    primaryScoreModel: primary?.model ?? null,
    revolvingBalanceCents,
    revolvingLimitCents,
    utilizationPct,
    openTradelines,
    derogatoryMarks,
    hardInquiriesTrailingYear,
    onTimePaymentRate: report.onTimePaymentRate,
  };
}
