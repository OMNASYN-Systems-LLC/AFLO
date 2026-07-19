/**
 * The seeded opportunity registry + its safety invariants (opportunity.v1.0.0).
 *
 * Seed notices are SYNTHETIC/illustrative — they cite real official bodies for
 * realism but their specifics are examples, not a live feed. A real feed would
 * ingest from the trusted sources under review; the shape and every guard here
 * are what that feed must satisfy.
 */

import {
  OPPORTUNITY_RULES_VERSION,
  REVIEW_REQUIRED_CATEGORIES,
  getTrustedSource,
  type OpportunityNotice,
} from "./model";
import { toClientSafeSummary, validateOpportunityLanguage } from "./language";

const SEED_NOTICES: readonly OpportunityNotice[] = [
  {
      id: "opp-ca-dpa",
      category: "assistance_program",
      title: "California first-time homebuyer down-payment assistance",
      summary:
        "A state program offers down-payment and closing-cost assistance to qualifying first-time homebuyers. Eligibility, funding availability, and terms are set by the program and change over time.",
      jurisdiction: "US-CA",
      publicationDate: "2026-01-15",
      effectiveDate: "2026-02-01",
      expirationDate: "2027-01-31",
      eligibilityFields: ["first-time buyer status", "household income limits", "property location", "homebuyer education"],
      citation: { sourceId: "ca-hcd", url: "https://www.hcd.ca.gov/grants-and-funding", retrievedOn: "2026-07-01" },
      verifiedEligibility: false,
      ruleVersion: OPPORTUNITY_RULES_VERSION,
    },
    {
      id: "opp-hud-counsel",
      category: "housing_program",
      title: "HUD-approved housing counseling",
      summary:
        "Free or low-cost housing counseling from HUD-approved agencies covers homebuying readiness, budgeting, and avoiding foreclosure. Availability varies by agency and location.",
      jurisdiction: "US",
      publicationDate: "2025-11-01",
      effectiveDate: "2025-11-01",
      expirationDate: null,
      eligibilityFields: ["none — counseling is broadly available"],
      citation: { sourceId: "hud", url: "https://www.hud.gov/housingcounseling", retrievedOn: "2026-07-01" },
      verifiedEligibility: false,
      ruleVersion: OPPORTUNITY_RULES_VERSION,
    },
    {
      id: "opp-irs-savers",
      category: "tax_update",
      title: "Saver's Credit for retirement contributions",
      summary:
        "The Saver's Credit is a tax credit for eligible contributions to a retirement account. Income thresholds and credit rates are set annually by the IRS.",
      jurisdiction: "US",
      publicationDate: "2026-01-05",
      effectiveDate: "2026-01-05",
      expirationDate: null,
      eligibilityFields: ["adjusted gross income", "retirement contributions", "filing status"],
      citation: { sourceId: "irs", url: "https://www.irs.gov/retirement-plans/plan-participant-employee/retirement-savings-contributions-savers-credit", retrievedOn: "2026-07-01" },
      verifiedEligibility: false,
      ruleVersion: OPPORTUNITY_RULES_VERSION,
    },
    {
      id: "opp-cfpb-settlement",
      category: "consumer_settlement",
      title: "CFPB consumer-protection settlement notice",
      summary:
        "A public settlement may provide redress to affected consumers of a specific institution. Whether any account relates to it is determined solely by the official settlement terms and administrator.",
      jurisdiction: "US",
      publicationDate: "2026-06-10",
      effectiveDate: "2026-06-10",
      expirationDate: "2026-12-31",
      eligibilityFields: ["named institution", "account/product type", "affected time period", "official claims process"],
      citation: { sourceId: "cfpb", url: "https://www.consumerfinance.gov/enforcement/actions", retrievedOn: "2026-07-01" },
      verifiedEligibility: false,
      ruleVersion: OPPORTUNITY_RULES_VERSION,
    },
];

export const OPPORTUNITY_REGISTRY: readonly OpportunityNotice[] = Object.freeze(
  SEED_NOTICES.map((n) => Object.freeze({ ...n, eligibilityFields: Object.freeze([...n.eligibilityFields]) })),
);

export function getOpportunityNotice(id: string): OpportunityNotice | undefined {
  return OPPORTUNITY_REGISTRY.find((n) => n.id === id);
}

/**
 * Whether surfacing this notice to a CLIENT requires prior staff review. True
 * for legal/claims categories (roadmap §4) — those never surface automatically.
 */
export function requiresHumanReview(notice: OpportunityNotice): boolean {
  return REVIEW_REQUIRED_CATEGORIES.includes(notice.category);
}

/**
 * Deterministic self-check of the registry's safety invariants for an ARBITRARY
 * set of notices. Empty ⇒ sound. Exported so tests can feed violating fixtures
 * and prove the guard detects them.
 */
export function validateOpportunityNotices(notices: readonly OpportunityNotice[]): string[] {
  const violations: string[] = [];
  const seen = new Set<string>();

  for (const n of notices) {
    if (seen.has(n.id)) violations.push(`duplicate notice id: ${n.id}`);
    seen.add(n.id);

    if (!getTrustedSource(n.citation.sourceId)) {
      violations.push(`notice ${n.id} cites an untrusted source: ${n.citation.sourceId}`);
    }
    if (n.verifiedEligibility) {
      violations.push(`notice ${n.id} must not assert verified eligibility at the registry level`);
    }
    if (n.ruleVersion !== OPPORTUNITY_RULES_VERSION) {
      violations.push(`notice ${n.id} has a stale rule version`);
    }
    // The title must carry no prohibited claim...
    const titleViolations = validateOpportunityLanguage(n.title);
    if (titleViolations.length > 0) {
      violations.push(`notice ${n.id} title trips safe-language: ${titleViolations.join(", ")}`);
    }
    // ...and it must render client-safe without throwing.
    try {
      toClientSafeSummary(n);
    } catch (error) {
      violations.push(`notice ${n.id} cannot render client-safe: ${(error as Error).message}`);
    }
  }

  return violations;
}

/** Validate the live registry — the CI guard. */
export function validateOpportunityRegistry(): string[] {
  return validateOpportunityNotices(OPPORTUNITY_REGISTRY);
}
