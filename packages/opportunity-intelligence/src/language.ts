/**
 * The safe-language boundary (opportunity.v1.0.0).
 *
 * Roadmap §4 hard rule: client-facing opportunity text may hedge ("a public
 * program may relate to your profile — review the official eligibility terms"),
 * but must NEVER assert eligibility, qualification, approval, entitlement, a
 * guarantee, or a specific dollar amount, unless eligibility has been formally
 * verified. This module enforces that deterministically.
 *
 * Design: the client-facing MESSAGE is a fixed, authored-safe template (the one
 * place an "eligibility terms" phrase is allowed). The UNTRUSTED free text —
 * a notice's `title` and its `eligibilityFields` — is screened with a strict
 * deny-list that errs toward blocking: for a compliance boundary a false
 * positive (over-block) is acceptable, a false negative (a leaked claim) is not.
 */

import {
  OPPORTUNITY_RULES_VERSION,
  REVIEW_REQUIRED_CATEGORIES,
  type OpportunityNotice,
} from "./model";

/**
 * Prohibited phrasings for untrusted client-facing free text. Broad by intent:
 * any eligibility/qualification/approval/entitlement assertion or monetary
 * figure is blocked regardless of grammatical subject or voice.
 */
export const PROHIBITED_LANGUAGE = [
  // "eligible" / "eligibility" in any claim (the hedged template's "eligibility
  // terms" lives in the authored message, which is not screened here).
  { code: "OPP_ELIGIBILITY_CLAIM", pattern: /\beligib(?:le|ility)\b/i },
  { code: "OPP_QUALIFY_CLAIM", pattern: /\bqualif(?:y|ies|ied)\b/i },
  { code: "OPP_APPROVAL_CLAIM", pattern: /\b(?:pre-?)?approv(?:e|ed|es|al|ing)\b/i },
  { code: "OPP_ENTITLEMENT_CLAIM", pattern: /\b(?:entitled|awarded|owed|granted\s+to\s+you)\b/i },
  // A promise of receipt in any person/voice.
  {
    code: "OPP_RECEIPT_CLAIM",
    pattern: /\b(?:you|your|applicants?|recipients?|beneficiar\w+)\b[^.]{0,40}\b(?:will|'ll|are|is|'re|have|has|can)\b[^.]{0,25}\b(?:receive|get|paid|obtain|collect)\b/i,
  },
  { code: "OPP_GUARANTEE", pattern: /\bguarantee(?:d|s)?\b/i },
  // Any specific monetary figure, with the currency sign/word on either side and
  // any (or no) spacing. A concrete amount in a pre-verification pointer reads
  // as an entitlement.
  {
    code: "OPP_DOLLAR_FIGURE",
    pattern: /(?:\$|\busd\b|\bdollars?\b|\bgrand\b)\s*[\d.,]*\d|\d[\d.,]*\s*(?:\$|\busd\b|\bdollars?\b|\bgrand\b)/i,
  },
] as const;

export type ProhibitedLanguageCode = (typeof PROHIBITED_LANGUAGE)[number]["code"];

/**
 * Return the codes of every prohibited pattern the text trips. Empty ⇒ safe.
 * Fail-closed: a non-string input is treated as a violation, not ignored.
 */
export function validateOpportunityLanguage(text: string): ProhibitedLanguageCode[] {
  if (typeof text !== "string") return PROHIBITED_LANGUAGE.map((p) => p.code);
  return PROHIBITED_LANGUAGE.filter((p) => p.pattern.test(text)).map((p) => p.code);
}

/** Human-readable jurisdiction phrase for the hedged summary. */
function jurisdictionPhrase(jurisdiction: string): string {
  if (jurisdiction === "US") return "a federal";
  if (jurisdiction.startsWith("US-")) return `a ${jurisdiction.slice(3)} state`;
  return "a public";
}

/** Build the fixed, authored-safe hedged message (no notice free text). */
function hedgedMessage(notice: OpportunityNotice): string {
  return (
    `${jurisdictionPhrase(notice.jurisdiction)} ${notice.category.replace(/_/g, " ")} may relate to your ` +
    `profile. Review the official eligibility terms at the source before acting — nothing here confirms ` +
    `eligibility or any amount.`
  );
}

export interface SafeOpportunitySummary {
  noticeId: string;
  /** The notice title, verbatim (validated to carry no prohibited claim). */
  title: string;
  /** The hedged, deterministic client-facing line — never an eligibility claim. */
  message: string;
  /** What the client should check per the official terms (each validated). */
  reviewEligibilityFields: readonly string[];
  /** Official source deep link for the client to verify independently. */
  sourceUrl: string;
  effectiveDate: string;
  expirationDate: string | null;
  ruleVersion: string;
}

export interface ClientSafeOptions {
  /**
   * Affirmative signal that a staff member has reviewed a legal/claims notice
   * (roadmap §4). Required before a `REVIEW_REQUIRED_CATEGORIES` notice can be
   * projected client-safe — otherwise this throws.
   */
  reviewApproved?: boolean;
}

/**
 * Build the ONLY client-facing projection of a notice. The message is the fixed
 * hedged template. The notice's title and every eligibility field are VALIDATED
 * against the safe-language boundary; any prohibited claim throws rather than
 * emit an unsafe string. Legal/claims categories additionally require an
 * explicit `reviewApproved` — the human-review gate is enforced here too, not
 * only in matching, so this formatter can never leak a review-required notice.
 */
export function toClientSafeSummary(
  notice: OpportunityNotice,
  options: ClientSafeOptions = {},
): SafeOpportunitySummary {
  if (REVIEW_REQUIRED_CATEGORIES.includes(notice.category) && !options.reviewApproved) {
    throw new Error(
      `opportunity notice ${notice.id} is a ${notice.category} — staff review is required before it may be rendered for a client`,
    );
  }

  const violations = [
    ...validateOpportunityLanguage(notice.title).map((c) => `title:${c}`),
    ...notice.eligibilityFields.flatMap((f, i) =>
      validateOpportunityLanguage(f).map((c) => `eligibilityFields[${i}]:${c}`),
    ),
  ];
  if (violations.length > 0) {
    throw new Error(
      `opportunity notice ${notice.id} cannot be rendered client-safe: prohibited language ${violations.join(", ")}`,
    );
  }

  return {
    noticeId: notice.id,
    title: notice.title,
    message: hedgedMessage(notice),
    reviewEligibilityFields: notice.eligibilityFields,
    sourceUrl: notice.citation.url,
    effectiveDate: notice.effectiveDate,
    expirationDate: notice.expirationDate,
    ruleVersion: OPPORTUNITY_RULES_VERSION,
  };
}
