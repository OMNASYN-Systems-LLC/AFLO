/**
 * The safe-language boundary (opportunity.v1.0.0).
 *
 * Roadmap §4 hard rule: the system MAY say "a public program/settlement may
 * relate to your profile — review the official eligibility terms", but MUST NOT
 * say "you are eligible", "you qualify", "you will receive $X", or otherwise
 * assert an entitlement/amount, unless eligibility has been formally verified.
 * This module enforces that deterministically for every client-facing string.
 */

import { OPPORTUNITY_RULES_VERSION, type OpportunityNotice } from "./model";

/**
 * Prohibited client-facing phrasings. Each is a second-person entitlement or
 * guarantee, or a specific dollar figure — none of which belong in a hedged,
 * pre-verification pointer. Matched case-insensitively.
 */
export const PROHIBITED_LANGUAGE = [
  { code: "OPP_ELIGIBILITY_CLAIM", pattern: /\byou(?:'re| are)\s+eligible\b/i },
  { code: "OPP_QUALIFY_CLAIM", pattern: /\byou\s+(?:qualify|are\s+qualified)\b/i },
  { code: "OPP_ENTITLEMENT_CLAIM", pattern: /\byou(?:'ll| will)?\s+(?:receive|get|be\s+awarded|be\s+approved)\b/i },
  { code: "OPP_GUARANTEE", pattern: /\bguarantee(?:d|s)?\b/i },
  { code: "OPP_APPROVAL_CLAIM", pattern: /\byou(?:'re| are)\s+approved\b/i },
  // A specific dollar figure in a pre-verification, client-facing pointer is a
  // de-facto entitlement claim; direct the client to the official terms instead.
  { code: "OPP_DOLLAR_FIGURE", pattern: /\$\s?\d/ },
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

export interface SafeOpportunitySummary {
  noticeId: string;
  /** The notice title, verbatim (validated to carry no prohibited claim). */
  title: string;
  /** The hedged, deterministic client-facing line — never an eligibility claim. */
  message: string;
  /** What the client should check per the official terms. */
  reviewEligibilityFields: readonly string[];
  /** Official source name + deep link for the client to verify independently. */
  sourceUrl: string;
  effectiveDate: string;
  expirationDate: string | null;
  ruleVersion: string;
}

/**
 * Build the ONLY client-facing projection of a notice. The message is composed
 * from a fixed hedged template ("may relate to your profile — review the
 * official terms"), never from free eligibility text. The notice title is
 * included but VALIDATED; if the title (or the composed message) trips the
 * safe-language boundary, this throws rather than emit an unsafe claim.
 */
export function toClientSafeSummary(notice: OpportunityNotice): SafeOpportunitySummary {
  const message =
    `${jurisdictionPhrase(notice.jurisdiction)} ${notice.category.replace(/_/g, " ")} may relate to your ` +
    `profile. Review the official eligibility terms at the source before acting — nothing here confirms ` +
    `eligibility or any amount.`;

  const violations = [
    ...validateOpportunityLanguage(notice.title),
    ...validateOpportunityLanguage(message),
  ];
  if (violations.length > 0) {
    throw new Error(
      `opportunity notice ${notice.id} cannot be rendered client-safe: prohibited language ${violations.join(", ")}`,
    );
  }

  return {
    noticeId: notice.id,
    title: notice.title,
    message,
    reviewEligibilityFields: notice.eligibilityFields,
    sourceUrl: notice.citation.url,
    effectiveDate: notice.effectiveDate,
    expirationDate: notice.expirationDate,
    ruleVersion: OPPORTUNITY_RULES_VERSION,
  };
}
