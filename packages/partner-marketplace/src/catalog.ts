/**
 * Partner directory types (partner.v1.0.0).
 *
 * A partner is a licensed/vetted EXTERNAL provider AFLO routes clients to — it
 * never becomes AFLO's own regulated capability (ADR-0007). No real partner
 * names or compensation figures are hardcoded in this package; providers are
 * synthetic in development and gain real entries only behind reviewed
 * commercial agreements.
 */

export const PARTNER_RULES_VERSION = "partner.v1.0.0";

export const PARTNER_CATEGORIES = [
  "credit_union",
  "cpa_tax",
  "housing_counselor",
  "nonprofit_credit_counseling",
  "small_business_lender",
  "financial_coach",
] as const;

export type PartnerCategory = (typeof PARTNER_CATEGORIES)[number];

export const PARTNER_CATEGORY_LABELS: Record<PartnerCategory, string> = {
  credit_union: "Credit union",
  cpa_tax: "CPA / tax professional",
  housing_counselor: "HUD-approved housing counselor",
  nonprofit_credit_counseling: "Nonprofit credit counseling",
  small_business_lender: "Small-business lender",
  financial_coach: "Independent financial coach",
};

/**
 * A referable external provider. `nonCommercial` marks options AFLO earns
 * nothing from — surfaced first as a first-class outcome. The disclosure and
 * criteria fields are plain-language and staff-authored; AFLO never verifies a
 * partner's license here, it only records what it relied on.
 */
export interface Partner {
  id: string;
  organizationId: string;
  /** Synthetic in dev — never a real partner name before a reviewed agreement. */
  name: string;
  category: PartnerCategory;
  /** The license/credential AFLO relied on when listing the partner. */
  licensingNote: string;
  /** True when AFLO receives no compensation for referring here. */
  nonCommercial: boolean;
  /** Plain-language disclosure of any compensation AFLO may receive. */
  compensationDisclosure: string;
  /** Deterministic eligibility criteria the client should plausibly meet. */
  eligibilityCriteria: string;
  /** Plain-language estimated cost to the client. */
  estimatedUserCost: string;
  /** Key risks the client should understand before engaging. */
  keyRisks: string;
  active: boolean;
}
