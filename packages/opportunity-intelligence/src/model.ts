/**
 * Opportunity & Risk Intelligence model (opportunity.v1.0.0).
 *
 * The domain is public programs, settlements, benefit changes, rate/tax
 * updates, and housing/consumer-protection notices that MIGHT be relevant to a
 * client. AFLO's role is strictly to SURFACE a hedged, cited pointer to the
 * official source — never to determine eligibility, promise a benefit, or state
 * a dollar amount a client will receive. Everything here is deterministic;
 * there is no AI and no external call. Seed data is illustrative/synthetic.
 */

export const OPPORTUNITY_RULES_VERSION = "opportunity.v1.0.0" as const;

/** Categories of public notice AFLO may surface. */
export const OPPORTUNITY_CATEGORIES = [
  "assistance_program", // grants / down-payment / benefit programs
  "housing_program",
  "tax_update",
  "rate_change",
  "benefit_change",
  "consumer_settlement", // legal/claims — always human-review
  "regulatory_notice",
] as const;

export type OpportunityCategory = (typeof OPPORTUNITY_CATEGORIES)[number];

/**
 * Categories that are LEGAL or CLAIMS related. Surfacing one to a client always
 * requires prior staff review (roadmap §4): the risk of implying an
 * entitlement or a settlement claim is too high to surface automatically.
 */
export const REVIEW_REQUIRED_CATEGORIES: readonly OpportunityCategory[] = [
  "consumer_settlement",
  "regulatory_notice",
];

/** A vetted, official information source. Only these may back a notice. */
export interface TrustedSource {
  /** Stable id (kebab-case). */
  readonly id: string;
  /** Official name of the issuing body. */
  readonly name: string;
  /** ISO-3166-2-ish jurisdiction: "US" (federal) or "US-CA" (state), etc. */
  readonly jurisdiction: string;
  /** Official homepage / program URL for citation. */
  readonly url: string;
}

/**
 * The trusted-source registry. Frozen; only official bodies. A notice that
 * cites a source not in this list is invalid (validateOpportunityRegistry).
 */
export const TRUSTED_SOURCES: readonly TrustedSource[] = Object.freeze(
  [
    { id: "cfpb", name: "Consumer Financial Protection Bureau", jurisdiction: "US", url: "https://www.consumerfinance.gov" },
    { id: "hud", name: "U.S. Department of Housing and Urban Development", jurisdiction: "US", url: "https://www.hud.gov" },
    { id: "irs", name: "Internal Revenue Service", jurisdiction: "US", url: "https://www.irs.gov" },
    { id: "ca-hcd", name: "California Department of Housing and Community Development", jurisdiction: "US-CA", url: "https://www.hcd.ca.gov" },
  ].map((s) => Object.freeze(s)),
);

export function getTrustedSource(id: string): TrustedSource | undefined {
  return TRUSTED_SOURCES.find((s) => s.id === id);
}

/** A citation to the exact source material a notice was drawn from. */
export interface SourceCitation {
  sourceId: string;
  /** Deep link to the specific program/notice page. */
  url: string;
  /** ISO date the source page was retrieved. */
  retrievedOn: string;
}

/**
 * A public opportunity/risk notice. `summary` is a factual, source-derived
 * description; it is NOT client-facing on its own — the client only ever sees
 * the hedged `toClientSafeSummary` projection, which is language-validated.
 */
export interface OpportunityNotice {
  readonly id: string;
  readonly category: OpportunityCategory;
  readonly title: string;
  /** Factual description drawn from the source; never an eligibility claim. */
  readonly summary: string;
  readonly jurisdiction: string;
  readonly publicationDate: string; // ISO date
  readonly effectiveDate: string; // ISO date
  /** ISO date after which the notice is stale; null if open-ended. */
  readonly expirationDate: string | null;
  /**
   * The fields that DETERMINE eligibility per the official terms — surfaced so
   * a client knows what to check. Storing them is NOT making a determination.
   */
  readonly eligibilityFields: readonly string[];
  readonly citation: SourceCitation;
  /**
   * Whether official eligibility has been FORMALLY verified for a specific
   * client. Always false at the notice level; a real verification is a
   * per-client, staff-recorded fact (out of scope here). Guards language.
   */
  readonly verifiedEligibility: false;
  readonly ruleVersion: string;
}
