/**
 * Partner Neutrality Engine (partner.v1.0.0) — the required guardrail from
 * ADR-0007 §3.
 *
 * Every partner recommendation must carry a complete neutrality record with
 * eight fields. A referral cannot be created without one (the store fails
 * closed on an incomplete record). Two hard rules hold everywhere:
 *
 *   - A partner's compensation NEVER affects the readiness calculation.
 *   - Compensation NEVER affects ranking without transparent labeling — so
 *     `orderPartnerOptions` sorts by non-commercial-first then name, never by
 *     any compensation amount.
 */

import { PARTNER_RULES_VERSION } from "./catalog";

/**
 * The eight required neutrality fields (ADR-0007 §3):
 * 1 why shown · 2 eligible alternatives · 3 compensation · 4 non-commercial
 * option exists · 5 estimated user cost · 6 key risks · 7 eligibility criteria
 * · 8 staff reviewed.
 */
export interface NeutralityRecord {
  whyShown: string;
  eligibleAlternatives: string[];
  compensationDisclosure: string;
  nonCommercialOptionExists: boolean;
  estimatedUserCost: string;
  keyRisks: string;
  eligibilityCriteria: string;
  staffReviewed: boolean;
}

export const NEUTRALITY_FIELDS = [
  "whyShown",
  "eligibleAlternatives",
  "compensationDisclosure",
  "nonCommercialOptionExists",
  "estimatedUserCost",
  "keyRisks",
  "eligibilityCriteria",
  "staffReviewed",
] as const satisfies readonly (keyof NeutralityRecord)[];

export type NeutralityReasonCode = "PN_COMPLETE" | "PN_MISSING_FIELDS";

export interface NeutralityValidation {
  complete: boolean;
  missingFields: string[];
  reasonCode: NeutralityReasonCode;
  ruleVersion: string;
}

function isNonEmptyString(value: unknown): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

/**
 * Validate a neutrality record, fail-closed. Every string field must be
 * present and non-empty; the booleans must be actual booleans;
 * `eligibleAlternatives` must be an array (an empty array is a valid honest
 * answer — "no other eligible options"). Missing fields are named.
 */
export function validateNeutralityRecord(
  record: Partial<NeutralityRecord> | null | undefined,
): NeutralityValidation {
  const base = { ruleVersion: PARTNER_RULES_VERSION };
  if (!record || typeof record !== "object") {
    return { complete: false, missingFields: [...NEUTRALITY_FIELDS], reasonCode: "PN_MISSING_FIELDS", ...base };
  }
  const missing: string[] = [];
  if (!isNonEmptyString(record.whyShown)) missing.push("whyShown");
  if (!Array.isArray(record.eligibleAlternatives)) missing.push("eligibleAlternatives");
  if (!isNonEmptyString(record.compensationDisclosure)) missing.push("compensationDisclosure");
  if (typeof record.nonCommercialOptionExists !== "boolean") missing.push("nonCommercialOptionExists");
  if (!isNonEmptyString(record.estimatedUserCost)) missing.push("estimatedUserCost");
  if (!isNonEmptyString(record.keyRisks)) missing.push("keyRisks");
  if (!isNonEmptyString(record.eligibilityCriteria)) missing.push("eligibilityCriteria");
  if (typeof record.staffReviewed !== "boolean") missing.push("staffReviewed");

  return missing.length === 0
    ? { complete: true, missingFields: [], reasonCode: "PN_COMPLETE", ...base }
    : { complete: false, missingFields: missing, reasonCode: "PN_MISSING_FIELDS", ...base };
}

/**
 * Compensation-neutral ordering. Non-commercial options come first (a
 * first-class outcome), then a stable alphabetical order by name. Compensation
 * is never a sort key — ranking may never be influenced by what AFLO earns
 * (ADR-0007 §3). Pure; does not mutate the input.
 */
export function orderPartnerOptions<T extends { nonCommercial: boolean; name: string }>(
  options: readonly T[],
): T[] {
  return [...options].sort((a, b) => {
    if (a.nonCommercial !== b.nonCommercial) return a.nonCommercial ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}
