import { EDUCATION_RULES_VERSION } from "./catalog";

/**
 * Deterministic education-assignment rules (education.v1.0.0).
 *
 * A trigger (a workflow event or a readiness condition) maps to a specific
 * lesson with a reason code — the same trigger always assigns the same
 * lesson, and every assignment records the rule version and reason. AI may
 * later *suggest* content, but the authoritative trigger→lesson mapping is
 * deterministic and staff-reviewable.
 */

export type EducationTrigger =
  | "high_utilization"
  | "incomplete_intake"
  | "missing_document"
  | "missed_action"
  | "appointment_preparation"
  | "capital_readiness_preparation"
  | "possible_commingling"
  | "roadmap_approved";

export type EducationReasonCode =
  | "EDU_UTILIZATION"
  | "EDU_INTAKE"
  | "EDU_DOCUMENT"
  | "EDU_MISSED_ACTION"
  | "EDU_APPT_PREP"
  | "EDU_CAPITAL_PREP"
  | "EDU_COMMINGLING"
  | "EDU_ROADMAP";

export interface EducationSelection {
  lessonId: string;
  trigger: EducationTrigger;
  reasonCode: EducationReasonCode;
  ruleVersion: string;
}

const TRIGGER_MAP: Record<EducationTrigger, { lessonId: string; reasonCode: EducationReasonCode }> = {
  high_utilization: { lessonId: "lsn-utilization", reasonCode: "EDU_UTILIZATION" },
  incomplete_intake: { lessonId: "lsn-intake", reasonCode: "EDU_INTAKE" },
  missing_document: { lessonId: "lsn-documents", reasonCode: "EDU_DOCUMENT" },
  missed_action: { lessonId: "lsn-habits", reasonCode: "EDU_MISSED_ACTION" },
  appointment_preparation: { lessonId: "lsn-appointment", reasonCode: "EDU_APPT_PREP" },
  capital_readiness_preparation: { lessonId: "lsn-capital", reasonCode: "EDU_CAPITAL_PREP" },
  possible_commingling: { lessonId: "lsn-commingling", reasonCode: "EDU_COMMINGLING" },
  roadmap_approved: { lessonId: "lsn-roadmap", reasonCode: "EDU_ROADMAP" },
};

/** Deterministically select the lesson for a trigger. */
export function selectEducation(trigger: EducationTrigger): EducationSelection {
  const mapped = TRIGGER_MAP[trigger];
  return {
    lessonId: mapped.lessonId,
    trigger,
    reasonCode: mapped.reasonCode,
    ruleVersion: EDUCATION_RULES_VERSION,
  };
}

export interface KnowledgeCheckResult {
  score: number; // fraction 0..1, rounded to 3 places
  passed: boolean;
  ruleVersion: string;
}

/**
 * Deterministic knowledge-check scoring. `passed` requires meeting the
 * lesson's threshold. Invalid inputs fail closed (score 0, not passed).
 */
export function scoreKnowledgeCheck(
  correct: number,
  total: number,
  passThreshold: number,
): KnowledgeCheckResult {
  const base = { ruleVersion: EDUCATION_RULES_VERSION };
  if (!Number.isFinite(correct) || !Number.isFinite(total) || total <= 0 || correct < 0 || correct > total) {
    return { ...base, score: 0, passed: false };
  }
  const score = Math.round((correct / total) * 1000) / 1000;
  return { ...base, score, passed: score >= passThreshold };
}
