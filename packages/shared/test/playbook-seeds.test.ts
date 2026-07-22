import { describe, expect, it } from "vitest";
import {
  contentBlocksApproval,
  getRule,
  PLAYBOOK_CONTENT_FIELDS,
  validatePlaybookContent,
  type PlaybookContentFieldKey,
} from "@aflo/rules";
import type { ClientDocument, MonthlyAction } from "../src";
import { GOLDEN_KEY_PLAYBOOK_DRAFTS } from "../src/data/playbook-seeds";

/**
 * The anti-invention contract over the 10 Golden Key seeds (founder: "Do not
 * invent Natalia's exact process"): every seed is a structurally-valid,
 * obviously-generic DRAFT that cannot be approved as-is, never claims founder
 * confirmation, and backs every open question with a discovery item.
 */

// TYPED against the shared domain vocabularies — drift is a compile error.
const DOC_TYPES: ClientDocument["docType"][] = [
  "credit_report",
  "income_verification",
  "bank_statement",
  "identification",
  "other",
];
const ACTION_CATEGORIES: MonthlyAction["category"][] = ["payment", "savings", "documentation", "education", "habit"];

describe("Golden Key playbook draft seeds", () => {
  it("ships exactly the 10 directive playbooks, all version 1.0.0 drafts with unique keys", () => {
    expect(GOLDEN_KEY_PLAYBOOK_DRAFTS).toHaveLength(10);
    const keys = GOLDEN_KEY_PLAYBOOK_DRAFTS.map((p) => p.playbookKey);
    expect(new Set(keys).size).toBe(10);
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      expect(seed.version).toBe("1.0.0");
      expect(seed.status).toBe("draft");
    }
  });

  it("every seed passes the kernel's structural validator", () => {
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      expect(validatePlaybookContent(seed.content), seed.playbookKey).toEqual([]);
    }
  });

  it("NEVER claims founder confirmation: no field is confirmed or approved", () => {
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      for (const field of PLAYBOOK_CONTENT_FIELDS) {
        const provenance = seed.content.fieldProvenance[field];
        expect(["assumption", "discovery_required"], `${seed.playbookKey}.${field}`).toContain(provenance);
      }
    }
  });

  it("no seed can be approved as-is (discovery blocks approval), and every discovery_required field has a discovery item", () => {
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      const blockers = contentBlocksApproval(seed.content);
      expect(blockers.length, seed.playbookKey).toBeGreaterThan(0);
      const covered = new Set(seed.discoveryItems.map((d) => d.checkpointRef));
      for (const field of blockers) {
        expect(covered.has(field), `${seed.playbookKey}: no discovery item for "${field}"`).toBe(true);
      }
    }
  });

  it("§9 COVERAGE: every seed queues a discovery item for EACH of the eight directive categories", () => {
    // Directive §9's eight unresolved-decision categories, mapped to the
    // content field each category's discovery question blocks.
    const SECTION_9_CATEGORIES: Record<string, PlaybookContentFieldKey> = {
      threshold: "triggeringConditions",
      "document requirement": "requiredDocuments",
      "escalation condition": "escalationCriteria",
      "communication template": "recommendedActions",
      "reviewer role": "humanReviewCheckpoints",
      "timing rule": "triggeringConditions",
      "completion evidence": "completionEvidence",
      "expected outcome": "outcomeMetrics",
    };
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      const covered = new Set(seed.discoveryItems.map((d) => d.checkpointRef));
      for (const [category, checkpointRef] of Object.entries(SECTION_9_CATEGORIES)) {
        expect(
          covered.has(checkpointRef),
          `${seed.playbookKey}: no discovery item for §9 category "${category}" (${checkpointRef})`,
        ).toBe(true);
      }
    }
  });

  it("uses only shared vocabularies for documents and action categories, and registered rule ids for calculations", () => {
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      for (const doc of seed.content.requiredDocuments) expect(DOC_TYPES, seed.playbookKey).toContain(doc);
      for (const action of seed.content.recommendedActions) {
        expect(ACTION_CATEGORIES, seed.playbookKey).toContain(action.category);
      }
      for (const calc of seed.content.calculations) {
        expect(getRule(calc), `${seed.playbookKey}: unregistered calculation "${calc}"`).toBeDefined();
      }
    }
  });

  it("placeholder triggers/escalations/action strategies are visibly labeled as pending discovery", () => {
    for (const seed of GOLDEN_KEY_PLAYBOOK_DRAFTS) {
      for (const trigger of seed.content.triggeringConditions) {
        expect(trigger.value, seed.playbookKey).toMatch(/placeholder|pending discovery/i);
      }
      for (const esc of seed.content.escalationCriteria) {
        expect(esc.condition, seed.playbookKey).toMatch(/placeholder|pending discovery/i);
      }
      for (const action of seed.content.recommendedActions) {
        expect(action.summary, seed.playbookKey).toMatch(/placeholder|pending discovery/i);
      }
    }
  });
});
