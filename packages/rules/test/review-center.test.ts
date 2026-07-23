import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_POLICIES,
  REVIEW_ARTIFACT_TYPES,
  REVIEW_CENTER_RULES_VERSION,
  REVIEW_DECISIONS,
  REVIEW_DECISION_REASON_CODES,
  REVIEW_ITEM_STATES,
  applyReviewDecision,
  canPublishReviewItem,
  canReview,
  conciergeRiskFor,
  escalateReviewerRole,
  isDecisionReasonValid,
  isTerminalReviewState,
  resolveReviewPolicy,
  reviewItemTransition,
  reviewTransitionsFrom,
  type ConciergeContentFlags,
  type ReviewItemState,
} from "../src/review-center";
import { getRule } from "../src/registry";

/**
 * Exhaustive proof of the Review Center kernel — the full 8×8 transition
 * matrix, the founder's forbidden paths, terminal semantics, the five
 * decisions with modification/reason pairing, the reviewer policy
 * (deny-by-default + separation of duties + upward-only overrides), and the
 * registry lockstep.
 */

const LEGAL: Array<[ReviewItemState, ReviewItemState, string]> = [
  ["draft", "awaiting_review", "RVC_SUBMITTED"],
  ["draft", "withdrawn", "RVC_WITHDRAWN"],
  ["draft", "superseded", "RVC_SUPERSEDED"],
  ["awaiting_review", "approved", "RVC_APPROVED"],
  ["awaiting_review", "rejected", "RVC_REJECTED"],
  ["awaiting_review", "deferred", "RVC_DEFERRED"],
  ["awaiting_review", "withdrawn", "RVC_WITHDRAWN"],
  ["awaiting_review", "superseded", "RVC_SUPERSEDED"],
  ["approved", "published", "RVC_PUBLISHED"],
  ["approved", "superseded", "RVC_SUPERSEDED"],
  ["published", "superseded", "RVC_SUPERSEDED"],
];

describe("reviewItemTransition — the full matrix", () => {
  it("allows exactly the allow-listed moves (the whole 8×8 grid)", () => {
    for (const from of REVIEW_ITEM_STATES) {
      for (const to of REVIEW_ITEM_STATES) {
        const result = reviewItemTransition(from, to);
        const legal = LEGAL.find(([f, t]) => f === from && t === to);
        if (from === to) {
          expect(result.allowed, `${from}→${to}`).toBe(false);
          expect(result.reasonCode).toBe("RVC_SAME_STATE");
        } else if (legal) {
          expect(result.allowed, `${from}→${to}`).toBe(true);
          expect(result.reasonCode).toBe(legal[2]);
        } else {
          expect(result.allowed, `${from}→${to} must be illegal`).toBe(false);
          expect(result.reasonCode).toBe("RVC_ILLEGAL_TRANSITION");
        }
        expect(result.ruleVersion).toBe(REVIEW_CENTER_RULES_VERSION);
      }
    }
  });

  it("FORBIDS the founder's never-paths: draft→published and awaiting_review→published", () => {
    expect(reviewItemTransition("draft", "published").allowed).toBe(false);
    expect(reviewItemTransition("awaiting_review", "published").allowed).toBe(false);
    // published is reachable ONLY through approved:
    const reachPublished = REVIEW_ITEM_STATES.filter(
      (from) => reviewItemTransition(from, "published").allowed,
    );
    expect(reachPublished).toEqual(["approved"]);
  });

  it("has NO return-for-edits edge: every exit from the queue is a decision, withdrawal, or supersession", () => {
    // The directive's model has no return path — an author revises by
    // withdrawing and submitting a new linked item.
    expect(reviewItemTransition("awaiting_review", "draft").allowed).toBe(false);
    expect(reviewItemTransition("approved", "draft").allowed).toBe(false);
    // approved's only exits: published, superseded.
    expect(reviewTransitionsFrom("approved").sort()).toEqual(["published", "superseded"]);
  });

  it("terminal states never exit (rejected, deferred, withdrawn, superseded)", () => {
    for (const terminal of ["rejected", "deferred", "withdrawn", "superseded"] as const) {
      expect(isTerminalReviewState(terminal)).toBe(true);
      expect(reviewTransitionsFrom(terminal)).toEqual([]);
      for (const to of REVIEW_ITEM_STATES) {
        if (to === terminal) continue;
        expect(reviewItemTransition(terminal, to).allowed, `${terminal}→${to}`).toBe(false);
      }
    }
    for (const open of ["draft", "awaiting_review", "approved", "published"] as const) {
      expect(isTerminalReviewState(open)).toBe(false);
    }
  });

  it("rejects unknown states fail-closed", () => {
    expect(reviewItemTransition("nope", "approved").reasonCode).toBe("RVC_UNKNOWN_STATE");
    expect(reviewItemTransition("draft", "nope").reasonCode).toBe("RVC_UNKNOWN_STATE");
  });
});

describe("applyReviewDecision — the five structured decisions", () => {
  const base = { fromState: "awaiting_review", modifiedFieldCount: 0, requiredReviewerRole: "staff" as const };

  it("approved_unchanged → approved, zero modifications required", () => {
    const ok = applyReviewDecision({ ...base, decision: "approved_unchanged", decisionReasonCode: "RVD_ACCURATE" });
    expect(ok).toMatchObject({ allowed: true, toState: "approved", reasonCode: "RVC_APPROVED" });
    const bad = applyReviewDecision({
      ...base,
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
      modifiedFieldCount: 2,
    });
    expect(bad).toMatchObject({ allowed: false, reasonCode: "RVC_UNEXPECTED_MODIFICATIONS", toState: "awaiting_review" });
  });

  it("approved_with_edits → approved, at least one modification required", () => {
    const ok = applyReviewDecision({
      ...base,
      decision: "approved_with_edits",
      decisionReasonCode: "RVD_EDITED_TONE",
      modifiedFieldCount: 1,
    });
    expect(ok).toMatchObject({ allowed: true, toState: "approved", reasonCode: "RVC_APPROVED_WITH_EDITS" });
    const bad = applyReviewDecision({
      ...base,
      decision: "approved_with_edits",
      decisionReasonCode: "RVD_EDITED_TONE",
    });
    expect(bad).toMatchObject({ allowed: false, reasonCode: "RVC_MISSING_MODIFICATIONS" });
  });

  it("rejected → rejected (terminal); deferred → deferred (terminal)", () => {
    expect(
      applyReviewDecision({ ...base, decision: "rejected", decisionReasonCode: "RVD_INACCURATE_FACTS" }),
    ).toMatchObject({ allowed: true, toState: "rejected" });
    expect(
      applyReviewDecision({ ...base, decision: "deferred", decisionReasonCode: "RVD_AWAITING_CLIENT_INPUT" }),
    ).toMatchObject({ allowed: true, toState: "deferred", reasonCode: "RVC_DEFERRED" });
  });

  it("escalated leaves the item awaiting_review and returns the raised floor", () => {
    const result = applyReviewDecision({
      ...base,
      decision: "escalated",
      decisionReasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    });
    expect(result).toMatchObject({
      allowed: true,
      toState: "awaiting_review",
      reasonCode: "RVC_ESCALATED",
      escalatedToRole: "organization_admin",
    });
    const fromAdmin = applyReviewDecision({
      ...base,
      requiredReviewerRole: "organization_admin",
      decision: "escalated",
      decisionReasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    });
    expect(fromAdmin.escalatedToRole).toBe("organization_owner");
  });

  it("DENIES escalation at the organization_owner ceiling (nowhere to go)", () => {
    const result = applyReviewDecision({
      ...base,
      requiredReviewerRole: "organization_owner",
      decision: "escalated",
      decisionReasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    });
    expect(result).toMatchObject({
      allowed: false,
      reasonCode: "RVC_ESCALATION_CEILING",
      toState: "awaiting_review", // unchanged
    });
    expect(result.escalatedToRole).toBeUndefined();
  });

  it("rejects a malformed modification count (negative, NaN, non-integer) fail-closed", () => {
    for (const bad of [-1, Number.NaN, 1.5]) {
      const result = applyReviewDecision({
        ...base,
        decision: "approved_with_edits",
        decisionReasonCode: "RVD_EDITED_TONE",
        modifiedFieldCount: bad,
      });
      expect(result.allowed, String(bad)).toBe(false);
      expect(result.reasonCode).toBe("RVC_INVALID_MODIFICATION_COUNT");
    }
  });

  it("decisions are only legal from awaiting_review", () => {
    for (const from of ["draft", "approved", "published", "rejected", "deferred", "withdrawn", "superseded"]) {
      const result = applyReviewDecision({
        decision: "approved_unchanged",
        fromState: from,
        modifiedFieldCount: 0,
        decisionReasonCode: "RVD_ACCURATE",
        requiredReviewerRole: "staff",
      });
      expect(result.allowed, from).toBe(false);
      expect(result.reasonCode).toBe("RVC_NOT_AWAITING_REVIEW");
      expect(result.toState).toBe(from); // never moves on denial
    }
  });

  it("rejects an unknown decision and a mismatched reason code, fail-closed", () => {
    expect(
      applyReviewDecision({ ...base, decision: "approve", decisionReasonCode: "RVD_ACCURATE" }).reasonCode,
    ).toBe("RVC_UNKNOWN_DECISION");
    // RVD_ACCURATE is not valid for `rejected`:
    expect(
      applyReviewDecision({ ...base, decision: "rejected", decisionReasonCode: "RVD_ACCURATE" }).reasonCode,
    ).toBe("RVC_INVALID_REASON_CODE");
    // ...and an unknown code is invalid for everything:
    expect(
      applyReviewDecision({ ...base, decision: "rejected", decisionReasonCode: "RVD_NOPE" }).reasonCode,
    ).toBe("RVC_INVALID_REASON_CODE");
  });

  it("every RVD reason code is valid for at least one decision, and only its declared ones", () => {
    for (const [code, entry] of Object.entries(REVIEW_DECISION_REASON_CODES)) {
      const declared = entry.decisions as readonly string[];
      expect(declared.length).toBeGreaterThan(0);
      for (const decision of REVIEW_DECISIONS) {
        expect(isDecisionReasonValid(decision, code)).toBe(declared.includes(decision));
      }
    }
  });
});

describe("reviewer policy — deny-by-default + separation of duties", () => {
  const highPolicy = { riskClassification: "high", requiredReviewerRole: "staff" } as const;

  it("denies a null role (Worker, Platform Admin, unauthenticated) — membership required", () => {
    const result = canReview({ ...highPolicy, reviewerRole: null, reviewerMemberId: "m1", authorMemberId: null });
    expect(result).toMatchObject({ allowed: false, reasonCode: "RVC_REVIEWER_NOT_MEMBER" });
  });

  it("denies non-reviewer membership roles (client, partner_viewer, garbage)", () => {
    for (const role of ["client", "partner_viewer", "admin", ""]) {
      const result = canReview({ ...highPolicy, reviewerRole: role, reviewerMemberId: "m1", authorMemberId: null });
      expect(result.reasonCode, role).toBe("RVC_ROLE_NOT_REVIEWER");
    }
  });

  it("enforces the role floor: staff cannot review an organization_admin-required item", () => {
    const result = canReview({
      riskClassification: "high",
      requiredReviewerRole: "organization_admin",
      reviewerRole: "staff",
      reviewerMemberId: "m1",
      authorMemberId: null,
    });
    expect(result.reasonCode).toBe("RVC_INSUFFICIENT_ROLE");
    // ...but an owner outranks the floor:
    expect(
      canReview({
        riskClassification: "high",
        requiredReviewerRole: "organization_admin",
        reviewerRole: "organization_owner",
        reviewerMemberId: "m1",
        authorMemberId: null,
      }).allowed,
    ).toBe(true);
  });

  it("high risk denies SELF-review; medium/low permit it; system-authored items have no author", () => {
    const self = canReview({ ...highPolicy, reviewerRole: "staff", reviewerMemberId: "m1", authorMemberId: "m1" });
    expect(self.reasonCode).toBe("RVC_SELF_REVIEW_DENIED");
    const other = canReview({ ...highPolicy, reviewerRole: "staff", reviewerMemberId: "m2", authorMemberId: "m1" });
    expect(other.allowed).toBe(true);
    const medium = canReview({
      riskClassification: "medium",
      requiredReviewerRole: "staff",
      reviewerRole: "staff",
      reviewerMemberId: "m1",
      authorMemberId: "m1",
    });
    expect(medium.allowed).toBe(true);
    const system = canReview({ ...highPolicy, reviewerRole: "staff", reviewerMemberId: "m1", authorMemberId: null });
    expect(system.allowed).toBe(true);
  });

  it("escalation walks staff → organization_admin → organization_owner → ceiling", () => {
    expect(escalateReviewerRole("staff")).toBe("organization_admin");
    expect(escalateReviewerRole("organization_admin")).toBe("organization_owner");
    expect(escalateReviewerRole("organization_owner")).toBeNull();
  });
});

describe("policy table + overrides", () => {
  it("matches the founder's risk-tier directive EXACTLY (2026-07-22 §9 + resolution 2026-07-23)", () => {
    // Exact-table assertion — a loop over a subset silently passes when a type
    // is misclassified, so we pin the WHOLE table. The directive lists
    // financial-summary publication and stage advancement as HIGH; concierge
    // recommendations default HIGH — FOUNDER-RESOLVED (continuous execution
    // authorization 2026-07-23, decision 1): HIGH is the fail-safe when
    // content flags are unknown, and only `conciergeRiskFor` (all seven
    // criteria false) may deterministically classify low/medium. Only routine
    // educational assignment sits at MEDIUM pending playbook discovery.
    expect(DEFAULT_REVIEW_POLICIES).toEqual({
      readiness_assessment: { riskClassification: "high", requiredReviewerRole: "staff" },
      roadmap_draft: { riskClassification: "high", requiredReviewerRole: "staff" },
      concierge_recommendation: { riskClassification: "high", requiredReviewerRole: "staff" },
      document_interpretation: { riskClassification: "high", requiredReviewerRole: "staff" },
      financial_summary: { riskClassification: "high", requiredReviewerRole: "staff" },
      educational_assignment: { riskClassification: "medium", requiredReviewerRole: "staff" },
      partner_referral: { riskClassification: "high", requiredReviewerRole: "organization_admin" },
      client_communication: { riskClassification: "high", requiredReviewerRole: "staff" },
      quarterly_report: { riskClassification: "high", requiredReviewerRole: "staff" },
      stage_advancement: { riskClassification: "high", requiredReviewerRole: "staff" },
    });
    // ...and the table covers exactly the declared artifact types (no drift).
    expect(Object.keys(DEFAULT_REVIEW_POLICIES).sort()).toEqual([...REVIEW_ARTIFACT_TYPES].sort());
  });

  it("org overrides may only RAISE the floor — lowering is clamped to the baseline", () => {
    // Raise: medium→high and staff→owner both stick (educational_assignment is
    // the one medium-baseline type).
    const raised = resolveReviewPolicy("educational_assignment", {
      riskClassification: "high",
      requiredReviewerRole: "organization_owner",
    });
    expect(raised).toEqual({ riskClassification: "high", requiredReviewerRole: "organization_owner" });
    // Lower: high→low and organization_admin→staff are both clamped.
    const clamped = resolveReviewPolicy("partner_referral", {
      riskClassification: "low",
      requiredReviewerRole: "staff",
    });
    expect(clamped).toEqual(DEFAULT_REVIEW_POLICIES.partner_referral);
    // No override = baseline.
    expect(resolveReviewPolicy("roadmap_draft")).toEqual(DEFAULT_REVIEW_POLICIES.roadmap_draft);
  });
});

describe("conciergeRiskFor — the founder's seven criteria (decision 2026-07-23 #1)", () => {
  const noFlags: ConciergeContentFlags = {
    containsCreditGuidance: false,
    containsDebtPrioritization: false,
    containsReadinessStageImplications: false,
    containsPartnerOrProductRouting: false,
    containsFinancialActionRecommendations: false,
    containsHousingOrFundingReadinessImplications: false,
    materiallyConsequential: false,
  };

  it("ANY single flag true → high, for each of the seven criteria", () => {
    for (const key of Object.keys(noFlags) as (keyof ConciergeContentFlags)[]) {
      expect(conciergeRiskFor({ ...noFlags, [key]: true }, "low"), key).toBe("high");
      expect(conciergeRiskFor({ ...noFlags, [key]: true }, "medium"), key).toBe("high");
    }
  });

  it("all flags false → the caller-chosen informational class (low or medium, never below)", () => {
    expect(conciergeRiskFor(noFlags, "low")).toBe("low");
    expect(conciergeRiskFor(noFlags, "medium")).toBe("medium");
  });

  it("multiple flags stay high; the DEFAULT_REVIEW_POLICIES fail-safe stays high", () => {
    expect(
      conciergeRiskFor({ ...noFlags, containsCreditGuidance: true, materiallyConsequential: true }, "low"),
    ).toBe("high");
    // The fail-safe when flags are unknown — the table default is HIGH.
    expect(DEFAULT_REVIEW_POLICIES.concierge_recommendation.riskClassification).toBe("high");
  });
});

describe("canPublishReviewItem — the founder-matrix publication floor", () => {
  it("staff can NEVER publish a high-risk item, even when the required reviewer role is staff", () => {
    const denied = canPublishReviewItem({ actorRole: "staff", risk: "high", requiredRole: "staff" });
    expect(denied).toMatchObject({ allowed: false, reasonCode: "RVC_INSUFFICIENT_ROLE" });
    expect(canPublishReviewItem({ actorRole: "organization_admin", risk: "high", requiredRole: "staff" }).allowed).toBe(true);
    expect(canPublishReviewItem({ actorRole: "organization_owner", risk: "high", requiredRole: "staff" }).allowed).toBe(true);
  });

  it("a high-risk item escalated to the owner floor requires the owner even for admins", () => {
    expect(
      canPublishReviewItem({ actorRole: "organization_admin", risk: "high", requiredRole: "organization_owner" }),
    ).toMatchObject({ allowed: false, reasonCode: "RVC_INSUFFICIENT_ROLE" });
    expect(
      canPublishReviewItem({ actorRole: "organization_owner", risk: "high", requiredRole: "organization_owner" }).allowed,
    ).toBe(true);
  });

  it("medium/low items require rank ≥ the item's required reviewer role", () => {
    expect(canPublishReviewItem({ actorRole: "staff", risk: "medium", requiredRole: "staff" }).allowed).toBe(true);
    expect(canPublishReviewItem({ actorRole: "staff", risk: "low", requiredRole: "staff" }).allowed).toBe(true);
    expect(
      canPublishReviewItem({ actorRole: "staff", risk: "medium", requiredRole: "organization_admin" }),
    ).toMatchObject({ allowed: false, reasonCode: "RVC_INSUFFICIENT_ROLE" });
  });

  it("denies a null role (Worker, Platform Admin) and non-reviewer roles, deny-by-default", () => {
    expect(canPublishReviewItem({ actorRole: null, risk: "low", requiredRole: "staff" })).toMatchObject({
      allowed: false,
      reasonCode: "RVC_REVIEWER_NOT_MEMBER",
    });
    for (const role of ["client", "partner_viewer", "staff_advisor", ""]) {
      expect(canPublishReviewItem({ actorRole: role, risk: "low", requiredRole: "staff" }).reasonCode, role).toBe(
        "RVC_ROLE_NOT_REVIEWER",
      );
    }
  });
});

describe("registry lockstep", () => {
  it("registers all review_center rules at the implementation version", () => {
    for (const id of [
      "review_center.item_lifecycle",
      "review_center.decision",
      "review_center.reviewer_policy",
      "review_center.publication_policy",
      "review_center.concierge_risk",
    ]) {
      const rule = getRule(id);
      expect(rule, id).toBeDefined();
      expect(rule!.version).toBe(REVIEW_CENTER_RULES_VERSION);
    }
  });
});
