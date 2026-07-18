/**
 * Deterministic client-intake completeness rules (intake.v1.0.0).
 *
 * Intake is a structured checklist of sections (founder-required set below);
 * organizations may reorder or extend it via settings, but completion is
 * always evaluated by these rules — an intake can only be declared complete
 * when every required section is complete, and every decision carries a
 * reason code. Section *data* lives in the domain records the sections feed
 * (financial profile, credit profile, goals, documents…), never in the rules.
 */

export const INTAKE_RULES_VERSION = "intake.v1.0.0";

export interface IntakeSectionDefinition {
  /** Stable id referenced by intake records and events (e.g. "identity"). */
  id: string;
  label: string;
  /** Position in the intake flow; unique, ascending. */
  order: number;
  /** Required sections must be complete before the intake can complete. */
  required: boolean;
}

export interface IntakeDefinition {
  id: string;
  version: string;
  sections: IntakeSectionDefinition[];
}

/**
 * Founder-required intake sections (Product Charter / commercial-grade
 * mandate): identity, communication preferences, consent, primary goal with
 * target date, self-reported credit info, income sources, debts, monthly
 * obligations, savings/reserves, documents, appointments, assigned staff.
 * The first coaching appointment may be scheduled after activation, so the
 * appointments section is the only optional one.
 */
export const DEFAULT_INTAKE: IntakeDefinition = {
  id: "aflo-default-intake",
  version: INTAKE_RULES_VERSION,
  sections: [
    { id: "identity", label: "Identity & contact", order: 1, required: true },
    { id: "communication_preferences", label: "Communication preferences", order: 2, required: true },
    { id: "consent", label: "Consent & disclosures", order: 3, required: true },
    { id: "primary_goal", label: "Primary goal & target date", order: 4, required: true },
    { id: "credit_self_report", label: "Self-reported credit info", order: 5, required: true },
    { id: "income_sources", label: "Income sources", order: 6, required: true },
    { id: "debts", label: "Debts", order: 7, required: true },
    { id: "monthly_obligations", label: "Monthly obligations", order: 8, required: true },
    { id: "savings_reserves", label: "Savings & reserves", order: 9, required: true },
    { id: "documents", label: "Initial documents", order: 10, required: true },
    { id: "appointments", label: "First appointment", order: 11, required: false },
    { id: "staff_assignment", label: "Assigned staff", order: 12, required: true },
  ],
};

export type IntakeReasonCode =
  | "IN_OK"
  | "IN_COMPLETE"
  | "IN_MISSING_REQUIRED"
  | "IN_UNKNOWN_SECTION"
  | "IN_SECTION_ALREADY_COMPLETE"
  | "IN_INVALID_DEFINITION";

/** Structural validation of an intake definition. Empty array = valid. */
export function validateIntakeDefinition(def: IntakeDefinition): string[] {
  const errors: string[] = [];
  if (def.sections.length === 0) errors.push("intake needs at least one section");
  const ids = def.sections.map((s) => s.id);
  if (new Set(ids).size !== ids.length) errors.push("section ids must be unique");
  const orders = def.sections.map((s) => s.order);
  if (new Set(orders).size !== orders.length) errors.push("section orders must be unique");
  if (!def.sections.some((s) => s.required)) errors.push("at least one section must be required");
  return errors;
}

export interface IntakeSectionResult {
  allowed: boolean;
  sectionId: string;
  reasonCode: IntakeReasonCode;
  ruleVersion: string;
}

/** May this section be marked complete, given the sections already complete? */
export function sectionCompletion(
  def: IntakeDefinition,
  completedSectionIds: readonly string[],
  sectionId: string,
): IntakeSectionResult {
  const base = { sectionId, ruleVersion: INTAKE_RULES_VERSION };
  if (validateIntakeDefinition(def).length > 0) {
    return { ...base, allowed: false, reasonCode: "IN_INVALID_DEFINITION" };
  }
  if (!def.sections.some((s) => s.id === sectionId)) {
    return { ...base, allowed: false, reasonCode: "IN_UNKNOWN_SECTION" };
  }
  if (completedSectionIds.includes(sectionId)) {
    return { ...base, allowed: false, reasonCode: "IN_SECTION_ALREADY_COMPLETE" };
  }
  return { ...base, allowed: true, reasonCode: "IN_OK" };
}

export interface IntakeCompletenessResult {
  complete: boolean;
  reasonCode: IntakeReasonCode;
  /** Required section ids not yet complete (deny evidence). */
  missingRequiredSectionIds: string[];
  /** Completed ids that are not in the definition — fail closed, never ignored. */
  unknownSectionIds: string[];
  completedRequiredCount: number;
  requiredCount: number;
  ruleVersion: string;
}

/** Deterministic completeness over the definition; fails closed on unknown ids. */
export function intakeCompleteness(
  def: IntakeDefinition,
  completedSectionIds: readonly string[],
): IntakeCompletenessResult {
  const required = def.sections.filter((s) => s.required);
  const base = {
    missingRequiredSectionIds: [] as string[],
    unknownSectionIds: [] as string[],
    completedRequiredCount: 0,
    requiredCount: required.length,
    ruleVersion: INTAKE_RULES_VERSION,
  };
  if (validateIntakeDefinition(def).length > 0) {
    return { ...base, complete: false, reasonCode: "IN_INVALID_DEFINITION" };
  }
  const known = new Set(def.sections.map((s) => s.id));
  const completed = new Set(completedSectionIds);
  const unknown = [...completed].filter((id) => !known.has(id));
  const missing = required.filter((s) => !completed.has(s.id)).map((s) => s.id);
  const result = {
    ...base,
    missingRequiredSectionIds: missing,
    unknownSectionIds: unknown,
    completedRequiredCount: required.length - missing.length,
  };
  if (unknown.length > 0) return { ...result, complete: false, reasonCode: "IN_UNKNOWN_SECTION" };
  if (missing.length > 0) return { ...result, complete: false, reasonCode: "IN_MISSING_REQUIRED" };
  return { ...result, complete: true, reasonCode: "IN_COMPLETE" };
}
