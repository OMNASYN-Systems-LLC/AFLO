import { describe, expect, it } from "vitest";
import {
  canActOnPlaybookVersion,
  contentBlocksApproval,
  FIELD_PROVENANCE_STATES,
  getRule,
  isHighImpactPlaybookContent,
  PLAYBOOK_ACTIONS,
  PLAYBOOK_CONTENT_FIELDS,
  PLAYBOOK_OVERRIDE_REASON_MAX_LENGTH,
  PLAYBOOK_RULES_VERSION,
  PLAYBOOK_VERSION_STATUSES,
  playbookVersionTransition,
  playbookVersionTransitionsFrom,
  REVIEW_ITEM_STATES,
  validatePlaybookContent,
  WORKFLOW_DISCOVERY_STATUSES,
  workflowDiscoveryTransition,
  workflowDiscoveryTransitionsFrom,
  type CanActOnPlaybookVersionInput,
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

describe("canActOnPlaybookVersion — founder decision 2026-07-23 #2 (author/approver separation)", () => {
  const base: CanActOnPlaybookVersionInput = {
    action: "draft",
    actorRole: "staff",
    actorIsAuthor: false,
    highImpact: false,
    ownerOverride: null,
    orgPolicyPermitsOverride: false,
  };
  const override = { reason: "Sole operator; no second reviewer exists.", attestsNotRegulatedAdvice: true as const };

  it("role floors: draft/revise/submit = staff+, approve = organization_admin+, publish = owner only", () => {
    for (const action of ["draft", "revise", "submit"] as const) {
      expect(canActOnPlaybookVersion({ ...base, action }).allowed, action).toBe(true);
    }
    expect(canActOnPlaybookVersion({ ...base, action: "approve" })).toMatchObject({
      allowed: false,
      reasonCode: "PB_ROLE_INSUFFICIENT",
    });
    expect(canActOnPlaybookVersion({ ...base, action: "approve", actorRole: "organization_admin" }).allowed).toBe(true);
    expect(canActOnPlaybookVersion({ ...base, action: "publish", actorRole: "organization_admin" })).toMatchObject({
      allowed: false,
      reasonCode: "PB_ROLE_INSUFFICIENT",
    });
    expect(canActOnPlaybookVersion({ ...base, action: "publish", actorRole: "organization_owner" }).allowed).toBe(true);
  });

  it("a null role (Worker, Platform Admin, client — no qualifying membership) is denied for EVERY action", () => {
    for (const action of PLAYBOOK_ACTIONS) {
      const result = canActOnPlaybookVersion({ ...base, action, actorRole: null });
      expect(result.allowed, action).toBe(false);
      expect(result.reasonCode, action).toBe("PB_NO_MEMBERSHIP");
    }
    // ...even with a (bogus) override attached — Platform Admin can never
    // approve or publish tenant content.
    expect(
      canActOnPlaybookVersion({
        ...base,
        action: "publish",
        actorRole: null,
        ownerOverride: override,
        orgPolicyPermitsOverride: true,
      }).reasonCode,
    ).toBe("PB_NO_MEMBERSHIP");
  });

  it("the author may never publish their own version (PB_AUTHOR_PUBLISHER_SEPARATION)", () => {
    expect(
      canActOnPlaybookVersion({ ...base, action: "publish", actorRole: "organization_owner", actorIsAuthor: true }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_AUTHOR_PUBLISHER_SEPARATION" });
    // A different owner-publisher is fine.
    expect(
      canActOnPlaybookVersion({ ...base, action: "publish", actorRole: "organization_owner", actorIsAuthor: false })
        .allowed,
    ).toBe(true);
  });

  it("high-impact versions require approver ≠ author; low-impact self-approval by an admin is allowed", () => {
    expect(
      canActOnPlaybookVersion({
        ...base,
        action: "approve",
        actorRole: "organization_admin",
        actorIsAuthor: true,
        highImpact: true,
      }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
    expect(
      canActOnPlaybookVersion({
        ...base,
        action: "approve",
        actorRole: "organization_admin",
        actorIsAuthor: true,
        highImpact: false,
      }).allowed,
    ).toBe(true);
  });

  it("owner override: permitted ONLY with org policy + non-empty reason + regulated-advice attestation", () => {
    const trip: CanActOnPlaybookVersionInput = {
      ...base,
      action: "publish",
      actorRole: "organization_owner",
      actorIsAuthor: true,
    };
    // Org policy off → denied even with a complete override.
    expect(canActOnPlaybookVersion({ ...trip, ownerOverride: override })).toMatchObject({
      allowed: false,
      reasonCode: "PB_OVERRIDE_NOT_PERMITTED",
    });
    // Empty reason / missing attestation → denied.
    expect(
      canActOnPlaybookVersion({
        ...trip,
        orgPolicyPermitsOverride: true,
        ownerOverride: { reason: "  ", attestsNotRegulatedAdvice: true },
      }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_OVERRIDE_REASON_REQUIRED" });
    expect(
      canActOnPlaybookVersion({
        ...trip,
        orgPolicyPermitsOverride: true,
        ownerOverride: { reason: "Sole operator", attestsNotRegulatedAdvice: false as unknown as true },
      }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_OVERRIDE_REASON_REQUIRED" });
    // Over-bound reason → denied (the reason lands in durable review history
    // and audit rows — never silently truncated; ADR-0047 review fix L1).
    expect(
      canActOnPlaybookVersion({
        ...trip,
        orgPolicyPermitsOverride: true,
        ownerOverride: {
          reason: "x".repeat(PLAYBOOK_OVERRIDE_REASON_MAX_LENGTH + 1),
          attestsNotRegulatedAdvice: true,
        },
      }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_OVERRIDE_REASON_TOO_LONG" });
    // Exactly at the bound (after trimming) → allowed.
    expect(
      canActOnPlaybookVersion({
        ...trip,
        orgPolicyPermitsOverride: true,
        ownerOverride: {
          reason: `  ${"x".repeat(PLAYBOOK_OVERRIDE_REASON_MAX_LENGTH)}  `,
          attestsNotRegulatedAdvice: true,
        },
      }),
    ).toMatchObject({ allowed: true, reasonCode: "PB_OWNER_OVERRIDE", usedOwnerOverride: true });
    // Complete override + policy → allowed, marked as the override path.
    expect(canActOnPlaybookVersion({ ...trip, orgPolicyPermitsOverride: true, ownerOverride: override })).toMatchObject({
      allowed: true,
      reasonCode: "PB_OWNER_OVERRIDE",
      usedOwnerOverride: true,
    });
    // High-impact self-approval by the owner rides the same override.
    expect(
      canActOnPlaybookVersion({
        ...base,
        action: "approve",
        actorRole: "organization_owner",
        actorIsAuthor: true,
        highImpact: true,
        orgPolicyPermitsOverride: true,
        ownerOverride: override,
      }),
    ).toMatchObject({ allowed: true, usedOwnerOverride: true });
  });

  it("the override never relaxes ROLE floors (admin cannot publish via override) and never applies to non-owners", () => {
    expect(
      canActOnPlaybookVersion({
        ...base,
        action: "publish",
        actorRole: "organization_admin",
        ownerOverride: override,
        orgPolicyPermitsOverride: true,
      }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_ROLE_INSUFFICIENT" });
    expect(
      canActOnPlaybookVersion({
        ...base,
        action: "approve",
        actorRole: "organization_admin",
        actorIsAuthor: true,
        highImpact: true,
        ownerOverride: override,
        orgPolicyPermitsOverride: true,
      }),
    ).toMatchObject({ allowed: false, reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
  });

  it("a normal allow never claims the override path", () => {
    const result = canActOnPlaybookVersion({
      ...base,
      action: "publish",
      actorRole: "organization_owner",
      ownerOverride: override,
      orgPolicyPermitsOverride: true,
    });
    expect(result).toMatchObject({ allowed: true, reasonCode: "PB_ACTION_ALLOWED", usedOwnerOverride: false });
  });
});

describe("isHighImpactPlaybookContent — the deterministic high-impact definition", () => {
  it("high iff any humanReviewCheckpoints entry has riskClassification 'high'", () => {
    expect(isHighImpactPlaybookContent(content())).toBe(true); // fixture checkpoint is high
    const medium = content({
      humanReviewCheckpoints: [
        {
          id: "cp1",
          afterStep: "a1",
          artifactType: "educational_assignment",
          riskClassification: "medium",
          requiredReviewerRole: "staff",
        },
      ],
    });
    expect(isHighImpactPlaybookContent(medium)).toBe(false);
    expect(isHighImpactPlaybookContent(content({ humanReviewCheckpoints: [] }))).toBe(false);
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
  it("registers the playbook rules at the implementation version", () => {
    for (const id of [
      "playbook.version_transition",
      "playbook.content_validation",
      "playbook.discovery",
      "playbook.actor_policy",
    ]) {
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
