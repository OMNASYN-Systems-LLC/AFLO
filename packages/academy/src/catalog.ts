import type { LifecycleStage } from "@aflo/rules";

/**
 * ΛFLO Wealth Academy content catalog (education.v1.0.0).
 *
 * Versioned, staff-authored learning content: courses group modules, modules
 * group lessons, plus standalone ebooks and workshops. Content is referenced
 * by stable id + `contentVersion`, so an assignment always records exactly
 * which version a client was given. No proprietary video is stored here — a
 * lesson references external media by a signed-playback key, never a raw URL.
 *
 * Academy completion is educational only; it never determines eligibility for
 * any regulated product (charter).
 */

export const EDUCATION_RULES_VERSION = "education.v1.0.0";

export type LessonFormat = "lesson" | "ebook" | "workshop";

export interface Lesson {
  id: string;
  title: string;
  summary: string;
  format: LessonFormat;
  /** Bumped when the content changes; recorded on every assignment. */
  contentVersion: string;
  /** Lifecycle stages this lesson is most relevant to (assignment hint). */
  stages: LifecycleStage[];
  /** Optional knowledge check — passing threshold is a fraction 0..1. */
  knowledgeCheck: { questionCount: number; passThreshold: number } | null;
  /** Signed-playback key for external media; never a raw URL (charter). */
  mediaKey: string | null;
}

export interface Module {
  id: string;
  title: string;
  lessonIds: string[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  moduleIds: string[];
}

export interface AcademyCatalog {
  version: string;
  courses: Course[];
  modules: Module[];
  lessons: Lesson[];
}

export function getLesson(catalog: AcademyCatalog, lessonId: string): Lesson | null {
  return catalog.lessons.find((l) => l.id === lessonId) ?? null;
}
