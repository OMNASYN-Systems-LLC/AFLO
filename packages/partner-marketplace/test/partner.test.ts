import { describe, expect, it } from "vitest";
import {
  NEUTRALITY_FIELDS,
  isTerminalReferralStatus,
  orderPartnerOptions,
  partnerReferralTransition,
  validateNeutralityRecord,
  type NeutralityRecord,
} from "../src";

const COMPLETE: NeutralityRecord = {
  whyShown: "Matches the client's credit-readiness stage and stated auto-refinance goal.",
  eligibleAlternatives: ["Nonprofit credit counseling", "Independent financial coach"],
  compensationDisclosure: "AFLO receives no compensation for this referral.",
  nonCommercialOptionExists: true,
  estimatedUserCost: "No cost to apply; membership share deposit may apply.",
  keyRisks: "A hard inquiry may temporarily lower the score a few points.",
  eligibilityCriteria: "Score 640+, utilization under 30%, 3 months of on-time payments.",
  staffReviewed: true,
};

describe("partnerReferralTransition", () => {
  it("allows the forward lifecycle and decline from any non-terminal state", () => {
    expect(partnerReferralTransition("suggested", "shared_with_client")).toMatchObject({ allowed: true, reasonCode: "PR_SHARED" });
    expect(partnerReferralTransition("shared_with_client", "client_engaged")).toMatchObject({ allowed: true, reasonCode: "PR_ENGAGED" });
    expect(partnerReferralTransition("client_engaged", "outcome_recorded")).toMatchObject({ allowed: true, reasonCode: "PR_OUTCOME" });
    expect(partnerReferralTransition("suggested", "declined")).toMatchObject({ allowed: true, reasonCode: "PR_DECLINED" });
    expect(partnerReferralTransition("client_engaged", "declined")).toMatchObject({ allowed: true, reasonCode: "PR_DECLINED" });
  });

  it("rejects skips, reversals, terminal exits, same-status, and unknown states", () => {
    expect(partnerReferralTransition("suggested", "client_engaged")).toMatchObject({ allowed: false, reasonCode: "PR_ILLEGAL_TRANSITION" });
    expect(partnerReferralTransition("client_engaged", "suggested")).toMatchObject({ allowed: false, reasonCode: "PR_ILLEGAL_TRANSITION" });
    expect(partnerReferralTransition("outcome_recorded", "shared_with_client")).toMatchObject({ allowed: false, reasonCode: "PR_ILLEGAL_TRANSITION" });
    expect(partnerReferralTransition("declined", "shared_with_client")).toMatchObject({ allowed: false, reasonCode: "PR_ILLEGAL_TRANSITION" });
    expect(partnerReferralTransition("suggested", "suggested")).toMatchObject({ allowed: false, reasonCode: "PR_SAME_STATUS" });
    expect(partnerReferralTransition("bogus", "declined")).toMatchObject({ allowed: false, reasonCode: "PR_UNKNOWN_STATUS" });
  });

  it("marks only outcome_recorded and declined terminal", () => {
    expect(isTerminalReferralStatus("outcome_recorded")).toBe(true);
    expect(isTerminalReferralStatus("declined")).toBe(true);
    expect(isTerminalReferralStatus("suggested")).toBe(false);
    expect(isTerminalReferralStatus("shared_with_client")).toBe(false);
    expect(isTerminalReferralStatus("client_engaged")).toBe(false);
  });
});

describe("validateNeutralityRecord", () => {
  it("accepts a complete eight-field record", () => {
    expect(validateNeutralityRecord(COMPLETE)).toMatchObject({ complete: true, missingFields: [], reasonCode: "PN_COMPLETE" });
  });

  it("names every missing field and fails closed on null", () => {
    expect(validateNeutralityRecord(null)).toMatchObject({
      complete: false,
      reasonCode: "PN_MISSING_FIELDS",
      missingFields: [...NEUTRALITY_FIELDS],
    });
  });

  it("rejects empty strings, a non-array alternatives, and non-boolean flags", () => {
    const bad = validateNeutralityRecord({
      ...COMPLETE,
      whyShown: "   ",
      eligibleAlternatives: "nope" as unknown as string[],
      staffReviewed: "yes" as unknown as boolean,
    });
    expect(bad.complete).toBe(false);
    expect(bad.missingFields).toEqual(["whyShown", "eligibleAlternatives", "staffReviewed"]);
  });

  it("accepts an empty alternatives array as an honest 'none eligible'", () => {
    expect(validateNeutralityRecord({ ...COMPLETE, eligibleAlternatives: [] }).complete).toBe(true);
  });
});

describe("orderPartnerOptions", () => {
  it("puts non-commercial options first, then alphabetical — never by compensation", () => {
    const options = [
      { name: "Zephyr Commercial Lender", nonCommercial: false },
      { name: "Anchor Commercial Lender", nonCommercial: false },
      { name: "Community Nonprofit Counseling", nonCommercial: true },
    ];
    expect(orderPartnerOptions(options).map((o) => o.name)).toEqual([
      "Community Nonprofit Counseling",
      "Anchor Commercial Lender",
      "Zephyr Commercial Lender",
    ]);
  });

  it("does not mutate the input", () => {
    const options = [
      { name: "B", nonCommercial: false },
      { name: "A", nonCommercial: true },
    ];
    const snapshot = options.map((o) => o.name);
    orderPartnerOptions(options);
    expect(options.map((o) => o.name)).toEqual(snapshot);
  });
});
