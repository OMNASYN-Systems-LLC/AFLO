import { describe, expect, it } from "vitest";
import {
  ACADEMY_LIBRARY,
  EDUCATION_RULES_VERSION,
  getLesson,
  scoreKnowledgeCheck,
  selectEducation,
  type EducationTrigger,
} from "../src";

const TRIGGERS: EducationTrigger[] = [
  "high_utilization",
  "incomplete_intake",
  "missing_document",
  "missed_action",
  "appointment_preparation",
  "capital_readiness_preparation",
  "possible_commingling",
  "roadmap_approved",
];

describe("selectEducation", () => {
  it("maps every trigger to an existing lesson deterministically", () => {
    for (const trigger of TRIGGERS) {
      const sel = selectEducation(trigger);
      expect(sel.ruleVersion).toBe(EDUCATION_RULES_VERSION);
      expect(sel.reasonCode).toMatch(/^EDU_/);
      // The selected lesson exists in the library.
      expect(getLesson(ACADEMY_LIBRARY, sel.lessonId)).not.toBeNull();
      // Same trigger → same lesson.
      expect(selectEducation(trigger)).toEqual(sel);
    }
  });

  it("routes high utilization to the utilization lesson", () => {
    expect(selectEducation("high_utilization")).toMatchObject({
      lessonId: "lsn-utilization",
      reasonCode: "EDU_UTILIZATION",
    });
  });
});

describe("scoreKnowledgeCheck", () => {
  it("passes when the score meets the threshold", () => {
    expect(scoreKnowledgeCheck(3, 4, 0.75)).toMatchObject({ score: 0.75, passed: true });
    expect(scoreKnowledgeCheck(4, 4, 0.75)).toMatchObject({ score: 1, passed: true });
  });

  it("fails below the threshold", () => {
    expect(scoreKnowledgeCheck(2, 4, 0.75)).toMatchObject({ score: 0.5, passed: false });
  });

  it("fails closed on invalid input", () => {
    expect(scoreKnowledgeCheck(5, 4, 0.75)).toMatchObject({ score: 0, passed: false });
    expect(scoreKnowledgeCheck(-1, 4, 0.75)).toMatchObject({ score: 0, passed: false });
    expect(scoreKnowledgeCheck(1, 0, 0.5)).toMatchObject({ score: 0, passed: false });
  });
});

describe("library integrity", () => {
  it("every module lesson id resolves to a lesson", () => {
    for (const mod of ACADEMY_LIBRARY.modules) {
      for (const id of mod.lessonIds) {
        expect(getLesson(ACADEMY_LIBRARY, id), id).not.toBeNull();
      }
    }
  });

  it("knowledge-check lessons declare a sane threshold and question count", () => {
    for (const lesson of ACADEMY_LIBRARY.lessons) {
      if (lesson.knowledgeCheck) {
        expect(lesson.knowledgeCheck.questionCount).toBeGreaterThan(0);
        expect(lesson.knowledgeCheck.passThreshold).toBeGreaterThan(0);
        expect(lesson.knowledgeCheck.passThreshold).toBeLessThanOrEqual(1);
      }
    }
  });
});
