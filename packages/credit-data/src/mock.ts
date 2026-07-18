/**
 * Synthetic mock credit-data provider (credit-data.v1.0.0).
 *
 * The only provider implementation in V1. It serves pre-built normalized
 * reports for known synthetic subjects — it touches no real bureau, no real
 * consumer, and grants no permissible purpose. `isProduction` is always false.
 */

import type {
  CreditDataProvider,
  CreditDataProviderInfo,
  CreditReportRequest,
} from "./provider";
import type {
  CreditScore,
  NormalizedCreditReport,
  NormalizedInquiry,
  NormalizedTradeline,
} from "./model";

export class UnknownSubjectError extends Error {
  constructor(public readonly subjectRef: string) {
    super(`no synthetic credit report for subject "${subjectRef}"`);
    this.name = "UnknownSubjectError";
  }
}

/**
 * A mock provider over an explicit map of synthetic reports keyed by
 * subjectRef. Deterministic: fetching a known subject returns its seeded
 * report; an unknown subject rejects (never fabricates data).
 */
export class MockCreditDataProvider implements CreditDataProvider {
  constructor(private readonly reports: Readonly<Record<string, NormalizedCreditReport>>) {}

  info(): CreditDataProviderInfo {
    return {
      id: "mock",
      displayName: "Synthetic credit-data provider (mock)",
      supportedScoreModels: ["vantagescore_3", "fico_8"],
      isProduction: false,
    };
  }

  fetchReport(request: CreditReportRequest): Promise<NormalizedCreditReport> {
    const report = this.reports[request.subjectRef];
    if (!report) return Promise.reject(new UnknownSubjectError(request.subjectRef));
    return Promise.resolve(report);
  }
}

export interface SyntheticReportInput {
  subjectRef: string;
  pulledAt: string;
  score: number;
  scoreModel?: CreditScore["model"];
  onTimePaymentRate: number;
  tradelines: NormalizedTradeline[];
  inquiries?: NormalizedInquiry[];
}

/** Build a deterministic normalized report from synthetic inputs (dev only). */
export function syntheticCreditReport(input: SyntheticReportInput): NormalizedCreditReport {
  return {
    source: "mock",
    subjectRef: input.subjectRef,
    pulledAt: input.pulledAt,
    scores: [{ value: input.score, model: input.scoreModel ?? "vantagescore_3", asOf: input.pulledAt.slice(0, 10) }],
    tradelines: input.tradelines,
    inquiries: input.inquiries ?? [],
    onTimePaymentRate: input.onTimePaymentRate,
  };
}
