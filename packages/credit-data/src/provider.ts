/**
 * Provider-neutral credit-data adapter (credit-data.v1.0.0).
 *
 * A provider is a source of normalized credit reports. Real bureau providers
 * (e.g. Experian Partner Solutions, Array) plug in behind THIS interface and
 * must produce the normalized AFLO model — the app never sees a bureau's raw
 * schema (ADR-0007 §5). In V1 the only implementation is the synthetic mock;
 * `isProduction` is false for it and for every provider until a reviewed
 * contract and compliance review exist.
 */

import type { CreditScoreModel, NormalizedCreditReport } from "./model";

/**
 * A recorded reason a report is being requested. In a real integration this
 * maps to an FCRA permissible purpose; here it is metadata only — the mock
 * provider touches no real consumer data and grants no permissible purpose.
 */
export const CREDIT_PULL_PURPOSES = ["account_review", "prequalification", "consumer_disclosure"] as const;

export type CreditPullPurpose = (typeof CREDIT_PULL_PURPOSES)[number];

export interface CreditReportRequest {
  /** Synthetic subject reference (a client id in dev) — never a real SSN. */
  subjectRef: string;
  purpose: CreditPullPurpose;
  requestedAt: string; // ISO datetime
}

export interface CreditDataProviderInfo {
  id: string;
  displayName: string;
  supportedScoreModels: CreditScoreModel[];
  /**
   * True ONLY for a real bureau provider operating under a reviewed contract
   * and compliance sign-off. No provider is production in V1.
   */
  isProduction: boolean;
}

export interface CreditDataProvider {
  info(): CreditDataProviderInfo;
  /** Resolve a normalized report for the subject, or reject if unavailable. */
  fetchReport(request: CreditReportRequest): Promise<NormalizedCreditReport>;
}
