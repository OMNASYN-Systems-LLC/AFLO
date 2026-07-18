import type { AcademyCatalog, Lesson } from "./catalog";

/**
 * Golden Key's starter Academy library — the Wealth Unlockers curriculum,
 * delivered through the ΛFLO Wealth Academy. Staff-authored, versioned;
 * lessons referenced by the deterministic trigger→lesson mapping.
 */

function lesson(
  id: string,
  title: string,
  summary: string,
  format: Lesson["format"],
  stages: Lesson["stages"],
  knowledgeCheck: Lesson["knowledgeCheck"] = null,
): Lesson {
  return { id, title, summary, format, contentVersion: "1.0.0", stages, knowledgeCheck, mediaKey: null };
}

const lessons: Lesson[] = [
  lesson("lsn-utilization", "Understanding credit utilization", "How revolving balances affect readiness, and how to sequence paydown.", "lesson", ["credit_readiness", "capital_readiness"], { questionCount: 4, passThreshold: 0.75 }),
  lesson("lsn-intake", "Getting your file complete", "Why a complete intake unlocks your roadmap, and what to gather.", "lesson", ["recovery", "stabilization"]),
  lesson("lsn-documents", "Documents that build trust", "Which documents your advisor needs and how to keep them current.", "lesson", ["stabilization", "credit_readiness"]),
  lesson("lsn-habits", "Small habits, steady progress", "Turning monthly actions into automatic routines.", "lesson", ["recovery", "stabilization", "credit_readiness"], { questionCount: 3, passThreshold: 0.67 }),
  lesson("lsn-appointment", "Making the most of your check-in", "How to prepare for an advisor appointment.", "workshop", ["recovery", "stabilization", "credit_readiness", "capital_readiness", "acquisition"]),
  lesson("lsn-capital", "Preparing for capital readiness", "What lenders look for and how reserves and DTI fit in.", "ebook", ["capital_readiness", "acquisition"], { questionCount: 5, passThreshold: 0.8 }),
  lesson("lsn-commingling", "Keeping business and personal separate", "Why commingling complicates readiness and how to untangle it.", "lesson", ["capital_readiness"]),
  lesson("lsn-roadmap", "Your roadmap, explained", "How to read your published roadmap and milestones.", "lesson", ["recovery", "stabilization", "credit_readiness", "capital_readiness", "acquisition"]),
];

export const ACADEMY_LIBRARY: AcademyCatalog = {
  version: "golden-key-academy-1.0.0",
  courses: [
    { id: "crs-foundations", title: "Readiness Foundations", description: "The essentials of financial readiness.", moduleIds: ["mod-basics", "mod-credit"] },
  ],
  modules: [
    { id: "mod-basics", title: "Getting started", lessonIds: ["lsn-intake", "lsn-documents", "lsn-habits", "lsn-roadmap"] },
    { id: "mod-credit", title: "Credit & capital", lessonIds: ["lsn-utilization", "lsn-capital", "lsn-commingling", "lsn-appointment"] },
  ],
  lessons,
};
