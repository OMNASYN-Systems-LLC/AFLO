import { describe, expect, it } from "vitest";
import {
  DEFAULT_REVIEW_POLICIES,
  REVIEW_ARTIFACT_TYPES,
  REVIEW_CENTER_RULES_VERSION,
  REVIEW_DECISIONS,
  REVIEW_DECISION_REASON_CODES,
  REVIEW_ITEM_STATES,
  applyReviewDecision,
  canReview,
  escalateReviewerRole,
  isDecisionReasonValid,
  isTerminalReviewState,
  resolveReviewPolicy,
  reviewItemTransition,
  reviewTransitionsFrom,
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
  ["awaiting_review", "draft", "RVC_RETURNED"],
  ["awaiting_review", "withdrawn", "RVC_WITHDRAWN"],
  ["awaiting_review", "superseded", "RVC_SUPERSEDED"],
  ["approved", "published", "RVC_PUBLISHED"],
  ["approved", "draft", "RVC_RETURNED"],
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
  const base = { fromState: "awaiting_review", modifiedFieldCount: 0 };

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

  it("escalated leaves the item awaiting_review (a decision, not a state)", () => {
    const result = applyReviewDecision({
      ...base,
      decision: "escalated",
      decisionReasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    });
    expect(result).toMatchObject({ allowed: true, toState: "awaiting_review", reasonCode: "RVC_ESCALATED" });
  });

  it("decisions are only legal from awaiting_review", () => {
    for (const from of ["draft", "approved", "published", "rejected", "deferred", "withdrawn", "superseded"]) {
      const result = applyReviewDecision({
        decision: "approved_unchanged",
        fromState: from,
        modifiedFieldCount: 0,
        decisionReasonCode: "RVD_ACCURATE",
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
  it("covers every artifact type; partner_referral is the OO/OA-only queue", () => {
    for (const type of REVIEW_ARTIFACT_TYPES) {
      expect(DEFAULT_REVIEW_POLICIES[type]).toBeDefined();
    }
    expect(DEFAULT_REVIEW_POLICIES.partner_referral.requiredReviewerRole).toBe("organization_admin");
    // Every high-tier artifact from the founder's list is classified high:
    for (const type of [
      "readiness_assessment",
      "roadmap_draft",
      "document_interpretation",
      "partner_referral",
      "client_communication",
      "quarterly_report",
    ] as const) {
      expect(DEFAULT_REVIEW_POLICIES[type].riskClassification, type).toBe("high");
    }
  });

  it("org overrides may only RAISE the floor — lowering is clamped to the baseline", () => {
    // Raise: medium→high and staff→owner both stick.
    const raised = resolveReviewPolicy("financial_summary", {
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

describe("registry lockstep", () => {
  it("registers all three review_center rules at the implementation version", () => {
    for (const id of ["review_center.item_lifecycle", "review_center.decision", "review_center.reviewer_policy"]) {
      const rule = getRule(id);
      expect(rule, id).toBeDefined();
      expect(rule!.version).toBe(REVIEW_CENTER_RULES_VERSION);
    }
  });
});
