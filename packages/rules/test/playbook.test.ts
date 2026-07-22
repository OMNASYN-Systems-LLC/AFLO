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

  it("rejects whitespace-only entries in every string-list field", () => {
    expect(validatePlaybookContent(content({ prohibitedActions: ["Never promise a score", "  "] }))).toContain(
      "prohibitedActions: entries must be non-empty",
    );
    expect(validatePlaybookContent(content({ requiredDocuments: [""] }))).toContain(
      "requiredDocuments: entries must be non-empty",
    );
    expect(validatePlaybookContent(content({ requiredFacts: [" "] }))).toContain(
      "requiredFacts: entries must be non-empty",
    );
    expect(validatePlaybookContent(content({ educationContent: [""] }))).toContain(
      "educationContent: entries must be non-empty",
    );
    expect(validatePlaybookContent(content({ completionEvidence: ["  "] }))).toContain(
      "completionEvidence: entries must be non-empty",
    );
    expect(validatePlaybookContent(content({ outcomeMetrics: [""] }))).toContain(
      "outcomeMetrics: entries must be non-empty",
    );
  });

  it("rejects duplicate recommendedActions ids and blank action fields", () => {
    const dup = validatePlaybookContent(
      content({
        recommendedActions: [
          { id: "a1", summary: "Pay down highest-utilization card", category: "credit" },
          { id: "a1", summary: "Another action", category: "credit" },
        ],
      }),
    );
    expect(dup).toContain('recommendedActions: duplicate id "a1"');
    const blank = validatePlaybookContent(
      content({ recommendedActions: [{ id: " ", summary: "", category: "  " }] }),
    );
    expect(blank).toContain("recommendedActions: id must be non-empty");
    expect(blank.some((e) => e.includes("summary for"))).toBe(true);
    expect(blank.some((e) => e.includes("category for"))).toBe(true);
  });

  it("rejects checkpoints whose afterStep does not reference a known action or question id", () => {
    const errors = validatePlaybookContent(
      content({
        humanReviewCheckpoints: [
          {
            id: "cp1",
            afterStep: "a999",
            artifactType: "roadmap_draft",
            riskClassification: "high",
            requiredReviewerRole: "staff",
          },
        ],
      }),
    );
    expect(errors).toContain(
      'humanReviewCheckpoints: afterStep "a999" of "cp1" does not reference a known action or question id',
    );
    // ...a questionSequence id is a legal afterStep too.
    expect(
      validatePlaybookContent(
        content({
          humanReviewCheckpoints: [
            {
              id: "cp1",
              afterStep: "q1",
              artifactType: "roadmap_draft",
              riskClassification: "high",
              requiredReviewerRole: "staff",
            },
          ],
        }),
      ),
    ).toEqual([]);
  });

  it("rejects blank/duplicate checkpoint and escalation ids and blank question ids", () => {
    const cp = content().humanReviewCheckpoints[0]!;
    const cps = validatePlaybookContent(
      content({ humanReviewCheckpoints: [{ ...cp, id: " " }, cp, { ...cp }] }),
    );
    expect(cps).toContain("humanReviewCheckpoints: id must be non-empty");
    expect(cps).toContain('humanReviewCheckpoints: duplicate id "cp1"');
    const esc = { id: "e1", condition: "client disputes a balance", escalateToRole: "organization_admin" as const };
    const escs = validatePlaybookContent(content({ escalationCriteria: [{ ...esc, id: "" }, esc, { ...esc }] }));
    expect(escs).toContain("escalationCriteria: id must be non-empty");
    expect(escs).toContain('escalationCriteria: duplicate id "e1"');
    expect(
      validatePlaybookContent(content({ questionSequence: [{ id: "  ", prompt: "A question?", capturesFactKey: null }] })),
    ).toContain("questionSequence: id must be non-empty");
  });

  it("rejects a whitespace-only fact_threshold ruleId", () => {
    const errors = validatePlaybookContent(
      content({ triggeringConditions: [{ kind: "fact_threshold", value: "utilization>0.5", ruleId: "  " }] }),
    );
    expect(errors.some((e) => e.includes("must name a backing ruleId"))).toBe(true);
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

  it("registry reasonCodes exactly equal the codes the machines actually emit", () => {
    const pbEmitted = new Set<string>();
    for (const from of PLAYBOOK_VERSION_STATUSES) {
      for (const to of PLAYBOOK_VERSION_STATUSES) {
        pbEmitted.add(playbookVersionTransition(from, to).reasonCode);
      }
    }
    pbEmitted.add(playbookVersionTransition("draft", "not-a-status").reasonCode); // PB_UNKNOWN_STATUS
    expect(getRule("playbook.version_transition")!.reasonCodes.slice().sort()).toEqual([...pbEmitted].sort());

    const wdEmitted = new Set<string>();
    for (const from of WORKFLOW_DISCOVERY_STATUSES) {
      for (const to of WORKFLOW_DISCOVERY_STATUSES) {
        wdEmitted.add(workflowDiscoveryTransition(from, to).reasonCode);
      }
    }
    wdEmitted.add(workflowDiscoveryTransition("open", "not-a-status").reasonCode); // WD_UNKNOWN_STATUS
    expect(getRule("playbook.discovery")!.reasonCodes.slice().sort()).toEqual([...wdEmitted].sort());
  });
});
