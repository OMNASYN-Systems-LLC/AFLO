import { describe, expect, it } from "vitest";
import {
  contentBlocksApproval,
  FIELD_PROVENANCE_STATES,
  getRule,
  PLAYBOOK_CONTENT_FIELDS,
  PLAYBOOK_RULES_VERSION,
  PLAYBOOK_VERSION_STATUSES,
  playbookVersionTransition,
  playbookVersionTransitionsFrom,
  REVIEW_ITEM_STATES,
  validatePlaybookContent,
  WORKFLOW_DISCOVERY_STATUSES,
  workflowDiscoveryTransition,
  workflowDiscoveryTransitionsFrom,
  type PlaybookContent,
} from "../src";

/** A minimal structurally-valid content fixture; tests override pieces. */
function content(overrides: Partial<PlaybookContent> = {}): PlaybookContent {
  const provenance = Object.fromEntries(PLAYBOOK_CONTENT_FIELDS.map((f) => [f, "assumption"])) as Record<
    (typeof PLAYBOOK_CONTENT_FIELDS)[number],
    (typeof FIELD_PROVENANCE_STATES)[number]
  >;
  return {
    purpose: "Reduce revolving utilization safely",
    applicableStages: ["credit_readiness"],
    triggeringConditions: [{ kind: "fact_threshold", value: "utilization>0.5", ruleId: "readiness.utilization" }],
    requiredFacts: ["revolving_balance_total"],
    requiredDocuments: ["credit_report"],
    calculations: ["readiness.utilization"],
    questionSequence: [{ id: "q1", prompt: "Which cards carry the balances?", capturesFactKey: null }],
    educationContent: [],
    recommendedActions: [{ id: "a1", summary: "Pay down highest-utilization card", category: "credit" }],
    prohibitedActions: ["Never promise a specific score change"],
    humanReviewCheckpoints: [
      {
        id: "cp1",
        afterStep: "a1",
        artifactType: "roadmap_draft",
        riskClassification: "high",
        requiredReviewerRole: "staff",
      },
    ],
    escalationCriteria: [{ id: "e1", condition: "client disputes a reported balance", escalateToRole: "organization_admin" }],
    completionEvidence: ["credit_report"],
    outcomeMetrics: ["utilization_delta"],
    fieldProvenance: provenance,
    ...overrides,
  };
}

describe("playbook version lifecycle — one vocabulary with the Review Center", () => {
  it("shares the Review Center state strings verbatim", () => {
    expect(PLAYBOOK_VERSION_STATUSES).toEqual(REVIEW_ITEM_STATES);
  });

  it("full matrix matches the allow-list exactly (no return edges; published only via approved)", () => {
    const LEGAL = new Set([
      "draft>awaiting_review",
      "draft>withdrawn",
      "draft>superseded",
      "awaiting_review>approved",
      "awaiting_review>rejected",
      "awaiting_review>deferred",
      "awaiting_review>withdrawn",
      "awaiting_review>superseded",
      "approved>published",
      "approved>superseded",
      "published>superseded",
    ]);
    for (const from of PLAYBOOK_VERSION_STATUSES) {
      for (const to of PLAYBOOK_VERSION_STATUSES) {
        const r = playbookVersionTransition(from, to);
        expect(r.ruleVersion).toBe(PLAYBOOK_RULES_VERSION);
        if (from === to) expect(r.reasonCode).toBe("PB_SAME_STATUS");
        else expect(r.allowed, `${from}>${to}`).toBe(LEGAL.has(`${from}>${to}`));
      }
    }
  });

  it("published is reachable ONLY from approved; terminals never exit", () => {
    for (const from of PLAYBOOK_VERSION_STATUSES) {
      if (from === "approved" || from === "published") continue;
      expect(playbookVersionTransition(from, "published").allowed, from).toBe(false);
    }
    for (const terminal of ["rejected", "deferred", "withdrawn", "superseded"] as const) {
      expect(playbookVersionTransitionsFrom(terminal)).toEqual([]);
    }
    // No return-for-edits: a decided version is revised via a NEW version.
    expect(playbookVersionTransitionsFrom("approved").sort()).toEqual(["published", "superseded"]);
  });

  it("rejects unknown statuses fail-closed", () => {
    expect(playbookVersionTransition("draft", "live").reasonCode).toBe("PB_UNKNOWN_STATUS");
    expect(playbookVersionTransition("", "draft").reasonCode).toBe("PB_UNKNOWN_STATUS");
  });
});

describe("validatePlaybookContent — structural + provenance contract", () => {
  it("accepts a structurally valid content object", () => {
    expect(validatePlaybookContent(content())).toEqual([]);
  });

  it("rejects empty purpose, empty stages, unknown stage, empty prohibited actions", () => {
    expect(validatePlaybookContent(content({ purpose: " " }))).toContain("purpose must be non-empty");
    expect(validatePlaybookContent(content({ applicableStages: [] }))).toContain("applicableStages must be non-empty");
    expect(
      validatePlaybookContent(content({ applicableStages: ["moon_phase" as never] })).some((e) =>
        e.includes('unknown lifecycle stage "moon_phase"'),
      ),
    ).toBe(true);
    expect(
      validatePlaybookContent(content({ prohibitedActions: [] })).some((e) => e.startsWith("prohibitedActions")),
    ).toBe(true);
  });

  it("fact_threshold triggers must name a backing ruleId", () => {
    const errors = validatePlaybookContent(
      content({ triggeringConditions: [{ kind: "fact_threshold", value: "utilization>0.5" }] }),
    );
    expect(errors.some((e) => e.includes("must name a backing ruleId"))).toBe(true);
  });

  it("review checkpoints may only RAISE the kernel review floor", () => {
    // roadmap_draft's kernel floor is high/staff — 'medium' lowers it: error.
    const errors = validatePlaybookContent(
      content({
        humanReviewCheckpoints: [
          {
            id: "cp-low",
            afterStep: "a1",
            artifactType: "roadmap_draft",
            riskClassification: "medium",
            requiredReviewerRole: "staff",
          },
        ],
      }),
    );
    expect(errors.some((e) => e.includes("below the kernel floor"))).toBe(true);
    // ...raising the role is fine.
    expect(
      validatePlaybookContent(
        content({
          humanReviewCheckpoints: [
            {
              id: "cp-high",
              afterStep: "a1",
              artifactType: "roadmap_draft",
              riskClassification: "high",
              requiredReviewerRole: "organization_owner",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("provenance must be exhaustive over the field list with known values only", () => {
    const missing = content();
    delete (missing.fieldProvenance as Record<string, unknown>).purpose;
    expect(validatePlaybookContent(missing)).toContain('fieldProvenance: missing entry for "purpose"');

    const bogus = content();
    (bogus.fieldProvenance as Record<string, string>).purpose = "vibes";
    expect(validatePlaybookContent(bogus)).toContain('fieldProvenance: unknown provenance "vibes" for "purpose"');

    const extra = content();
    (extra.fieldProvenance as Record<string, string>).secretSauce = "confirmed";
    expect(validatePlaybookContent(extra)).toContain('fieldProvenance: unknown field "secretSauce"');
  });

  it("contentBlocksApproval names exactly the discovery_required fields", () => {
    const c = content();
    c.fieldProvenance.calculations = "discovery_required";
    c.fieldProvenance.escalationCriteria = "discovery_required";
    expect(contentBlocksApproval(c).sort()).toEqual(["calculations", "escalationCriteria"]);
    // assumptions do NOT block (visibly labeled scaffolding), confirmed/approved never do.
    expect(contentBlocksApproval(content())).toEqual([]);
  });
});

describe("workflow discovery lifecycle", () => {
  it("full matrix matches the allow-list exactly; converted is terminal", () => {
    const LEGAL = new Set(["open>answered", "open>dismissed", "answered>converted", "answered>open", "dismissed>open"]);
    for (const from of WORKFLOW_DISCOVERY_STATUSES) {
      for (const to of WORKFLOW_DISCOVERY_STATUSES) {
        const r = workflowDiscoveryTransition(from, to);
        if (from === to) expect(r.reasonCode).toBe("WD_SAME_STATUS");
        else expect(r.allowed, `${from}>${to}`).toBe(LEGAL.has(`${from}>${to}`));
      }
    }
    expect(workflowDiscoveryTransitionsFrom("converted")).toEqual([]);
    expect(workflowDiscoveryTransition("open", "resolved").reasonCode).toBe("WD_UNKNOWN_STATUS");
  });
});

describe("registry lockstep", () => {
  it("registers the three playbook rules at the implementation version", () => {
    for (const id of ["playbook.version_transition", "playbook.content_validation", "playbook.discovery"]) {
      const rule = getRule(id);
      expect(rule, id).toBeDefined();
      expect(rule!.version).toBe(PLAYBOOK_RULES_VERSION);
    }
  });
});
