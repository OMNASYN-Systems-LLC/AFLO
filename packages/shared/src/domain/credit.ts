import type { CreditFacts } from "@aflo/credit-data";

/**
 * A display-only summary of a client's normalized credit report, produced for
 * STAFF review. It is deliberately separate from the staff-maintained
 * `CreditProfile` (manual entry / uploaded report) and from the readiness
 * inputs: a report summary is UNVERIFIED reported data and NEVER feeds the
 * deterministic readiness engine. In V1 the only source is the synthetic mock
 * provider — `isProduction` is always false and there is no bureau access.
 */

export type CreditReportUnavailableReason = "consent_required" | "no_report";

export interface CreditReportSummary {
  clientId: string;
  /** True only when data-processing consent is active AND a report exists. */
  available: boolean;
  /** Why the summary is unavailable; null when available. */
  reason: CreditReportUnavailableReason | null;
  /** ALWAYS false in V1 — the only provider is the synthetic mock. */
  isProduction: boolean;
  /** Provider id (e.g. "mock"); null when unavailable. */
  source: string | null;
  /** ISO datetime the report was pulled; null when unavailable. */
  pulledAt: string | null;
  /** Deterministically summarized facts; null when unavailable. */
  facts: CreditFacts | null;
  /**
   * Always false: this display path surfaces UNVERIFIED reported data. Staff
   * must verify before any figure is relied on; it never auto-updates the
   * CreditProfile or the readiness assessment.
   */
  staffVerified: false;
}
