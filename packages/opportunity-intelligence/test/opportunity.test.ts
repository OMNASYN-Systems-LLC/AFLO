import { describe, expect, it } from "vitest";
import {
  OPPORTUNITY_CATEGORIES,
  OPPORTUNITY_REGISTRY,
  OPPORTUNITY_RULES_VERSION,
  TRUSTED_SOURCES,
  getOpportunityNotice,
  matchNoticeToProfile,
  requiresHumanReview,
  toClientSafeSummary,
  validateOpportunityLanguage,
  validateOpportunityNotices,
  validateOpportunityRegistry,
  type ClientOpportunitySignals,
  type OpportunityNotice,
} from "../src";

const NOW = new Date("2026-07-18T12:00:00.000Z");

const caBuyer: ClientOpportunitySignals = {
  jurisdiction: "US-CA",
  goalCategories: ["home_purchase", "savings"],
  now: NOW,
};

describe("safe-language boundary", () => {
  it("flags second-person eligibility / entitlement / guarantee / dollar claims", () => {
    expect(validateOpportunityLanguage("You are eligible for this program")).toContain("OPP_ELIGIBILITY_CLAIM");
    expect(validateOpportunityLanguage("You qualify today")).toContain("OPP_QUALIFY_CLAIM");
    expect(validateOpportunityLanguage("You will receive the funds")).toContain("OPP_ENTITLEMENT_CLAIM");
    expect(validateOpportunityLanguage("Approval is guaranteed")).toContain("OPP_GUARANTEE");
    expect(validateOpportunityLanguage("You are approved")).toContain("OPP_APPROVAL_CLAIM");
    expect(validateOpportunityLanguage("Eliminate $3,000 of debt")).toContain("OPP_DOLLAR_FIGURE");
  });

  it("passes hedged, non-committal language", () => {
    expect(
      validateOpportunityLanguage("A public program may relate to your profile. Review the official terms."),
    ).toEqual([]);
  });

  it("fails closed on a non-string input", () => {
    expect(validateOpportunityLanguage(undefined as unknown as string).length).toBeGreaterThan(0);
  });

  it("toClientSafeSummary emits a hedged message with no prohibited language", () => {
    const notice = getOpportunityNotice("opp-ca-dpa")!;
    const safe = toClientSafeSummary(notice);
    expect(safe.message).toMatch(/may relate to your profile/i);
    expect(validateOpportunityLanguage(safe.message)).toEqual([]);
    expect(safe.message).not.toMatch(/\$/);
    expect(safe.sourceUrl).toBe(notice.citation.url);
    expect(safe.reviewEligibilityFields).toEqual(notice.eligibilityFields);
  });

  it("refuses to render a notice whose title carries a prohibited claim", () => {
    const bad: OpportunityNotice = { ...getOpportunityNotice("opp-hud-counsel")!, title: "You are eligible for $5,000" };
    expect(() => toClientSafeSummary(bad)).toThrow(/prohibited language/);
  });
});

describe("profile-relevance matching (surface-worthiness, never eligibility)", () => {
  it("surfaces a goal-aligned, in-jurisdiction, non-expired program", () => {
    const m = matchNoticeToProfile(getOpportunityNotice("opp-ca-dpa")!, caBuyer);
    expect(m.relevant).toBe(true);
    expect(m.reasonCodes).toContain("OM_JURISDICTION_MATCH");
    expect(m.reasonCodes).toContain("OM_GOAL_ALIGNED");
    expect(m.requiresReview).toBe(false);
  });

  it("federal notices apply to any jurisdiction", () => {
    const m = matchNoticeToProfile(getOpportunityNotice("opp-irs-savers")!, { ...caBuyer, jurisdiction: "US-TX" });
    expect(m.relevant).toBe(true);
    expect(m.reasonCodes).toContain("OM_FEDERAL");
    expect(m.reasonCodes).toContain("OM_BROADLY_APPLICABLE");
  });

  it("does not surface a state program to a client in another state", () => {
    const m = matchNoticeToProfile(getOpportunityNotice("opp-ca-dpa")!, { ...caBuyer, jurisdiction: "US-TX" });
    expect(m.relevant).toBe(false);
    expect(m.reasonCodes).toEqual(["OM_JURISDICTION_MISMATCH"]);
  });

  it("does not surface a goal-gated program without an aligned goal", () => {
    const m = matchNoticeToProfile(getOpportunityNotice("opp-ca-dpa")!, { ...caBuyer, goalCategories: ["credit"] });
    expect(m.relevant).toBe(false);
    expect(m.reasonCodes).toContain("OM_NOT_GOAL_ALIGNED");
  });

  it("does not surface an expired notice", () => {
    const m = matchNoticeToProfile(getOpportunityNotice("opp-cfpb-settlement")!, {
      ...caBuyer,
      now: new Date("2027-06-01T00:00:00.000Z"),
    });
    expect(m.relevant).toBe(false);
    expect(m.reasonCodes).toEqual(["OM_EXPIRED"]);
  });

  it("flags legal/claims notices as requiring staff review before a client sees them", () => {
    const settlement = getOpportunityNotice("opp-cfpb-settlement")!;
    expect(requiresHumanReview(settlement)).toBe(true);
    expect(matchNoticeToProfile(settlement, caBuyer).requiresReview).toBe(true);
    expect(requiresHumanReview(getOpportunityNotice("opp-hud-counsel")!)).toBe(false);
  });
});

describe("registry invariants", () => {
  it("the live registry passes its self-check", () => {
    expect(validateOpportunityRegistry()).toEqual([]);
  });

  it("every seed notice is frozen, cites a trusted source, and has the current rule version", () => {
    for (const n of OPPORTUNITY_REGISTRY) {
      expect(Object.isFrozen(n)).toBe(true);
      expect(TRUSTED_SOURCES.some((s) => s.id === n.citation.sourceId)).toBe(true);
      expect(OPPORTUNITY_CATEGORIES).toContain(n.category);
      expect(n.ruleVersion).toBe(OPPORTUNITY_RULES_VERSION);
      expect(n.verifiedEligibility).toBe(false);
    }
  });

  it("validateOpportunityNotices DETECTS violations (not just passes the clean seed)", () => {
    const ok = getOpportunityNotice("opp-hud-counsel")!;
    expect(validateOpportunityNotices([{ ...ok, citation: { ...ok.citation, sourceId: "shady-blog" } }]).some((v) => v.includes("untrusted source"))).toBe(true);
    expect(validateOpportunityNotices([{ ...ok, verifiedEligibility: true as unknown as false }]).some((v) => v.includes("verified eligibility"))).toBe(true);
    expect(validateOpportunityNotices([ok, { ...ok }]).some((v) => v.includes("duplicate notice id"))).toBe(true);
    expect(validateOpportunityNotices([{ ...ok, ruleVersion: "opportunity.v0.9.0" }]).some((v) => v.includes("stale rule version"))).toBe(true);
    expect(validateOpportunityNotices([{ ...ok, title: "You are eligible" }]).some((v) => v.includes("safe-language"))).toBe(true);
  });
});
