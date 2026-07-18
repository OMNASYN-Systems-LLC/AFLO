/**
 * The normalized, provider-neutral AFLO credit model (credit-data.v1.0.0).
 *
 * ADR-0007 §5: the credit-data layer is NEVER architected around one bureau's
 * proprietary response schema. Every provider — a real bureau behind a reviewed
 * contract, or the synthetic mock — normalizes into these shapes, which then
 * feed the deterministic rules and, later, the credit-intelligence agents.
 *
 * No production bureau is wired in V1. These types carry synthetic data only;
 * an AFLO readiness stage is never derived here and never presented as a bureau
 * score.
 */

export const CREDIT_DATA_RULES_VERSION = "credit-data.v1.0.0";

/** Score models a provider may report. `unknown` when a provider omits it. */
export const CREDIT_SCORE_MODELS = [
  "vantagescore_3",
  "vantagescore_4",
  "fico_8",
  "fico_9",
  "unknown",
] as const;

export type CreditScoreModel = (typeof CREDIT_SCORE_MODELS)[number];

export interface CreditScore {
  /** Typically 300–850; not validated here (providers vary). */
  value: number;
  model: CreditScoreModel;
  asOf: string; // ISO date
}

export const TRADELINE_TYPES = [
  "revolving",
  "installment",
  "mortgage",
  "auto",
  "student",
  "other",
] as const;

export type TradelineType = (typeof TRADELINE_TYPES)[number];

export const TRADELINE_STATUSES = ["open", "closed", "paid", "collection", "charge_off"] as const;

export type TradelineStatus = (typeof TRADELINE_STATUSES)[number];

export interface NormalizedTradeline {
  id: string;
  type: TradelineType;
  status: TradelineStatus;
  balanceCents: number;
  /** Credit limit for revolving lines; null for installment/mortgage/auto. */
  creditLimitCents: number | null;
  monthlyPaymentCents: number;
  openedOn: string; // ISO date
  pastDueAmountCents: number;
  /** A derogatory mark: collection, charge-off, or serious delinquency. */
  isDerogatory: boolean;
}

export const INQUIRY_TYPES = ["hard", "soft"] as const;

export type InquiryType = (typeof INQUIRY_TYPES)[number];

export interface NormalizedInquiry {
  id: string;
  type: InquiryType;
  occurredOn: string; // ISO date
}

/**
 * A full normalized credit report. `subjectRef` is a synthetic reference (a
 * client id in dev) — never a real SSN or bureau file number.
 */
export interface NormalizedCreditReport {
  /** The provider id that produced this report (e.g. "mock"). */
  source: string;
  subjectRef: string;
  pulledAt: string; // ISO datetime
  scores: CreditScore[];
  tradelines: NormalizedTradeline[];
  inquiries: NormalizedInquiry[];
  /** On-time payment rate over the trailing 24 months, 0..1. */
  onTimePaymentRate: number;
}
