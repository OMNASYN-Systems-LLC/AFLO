import { describe, expect, it } from "vitest";
import { deserializeEvent } from "../src/events";
import { AfloStore } from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";
import type { NeutralityRecord } from "@aflo/partner-marketplace";

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-18T12:00:00.000Z");

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

const COMPLETE: NeutralityRecord = {
  whyShown: "Fits the client's stage and stated goal.",
  eligibleAlternatives: ["Solid Ground Nonprofit Credit Counseling"],
  compensationDisclosure: "AFLO receives no compensation for this referral.",
  nonCommercialOptionExists: true,
  estimatedUserCost: "No cost to apply.",
  keyRisks: "A hard inquiry may temporarily lower the score.",
  eligibilityCriteria: "Membership eligibility.",
  staffReviewed: true,
};

describe("createReferral", () => {
  it("creates a tracked referral with a complete neutrality record and emits the event", () => {
    const store = makeStore();
    const res = store.createReferral({
      organizationId: ORG,
      clientId: "c-grant",
      partnerId: "pt-cedarline-cu",
      neutrality: COMPLETE,
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.referral).toMatchObject({
      clientId: "c-grant",
      partnerId: "pt-cedarline-cu",
      status: "suggested",
      outcome: null,
    });
    const event = deserializeEvent(store.outbox.at(-1)!.serializedEvent);
    expect(event.eventType).toBe("PartnerReferralCreated");
    expect(event.payload).toMatchObject({ clientId: "c-grant", partnerId: "pt-cedarline-cu" });
    expect(store.auditFor(ORG).at(-1)).toMatchObject({ action: "partner_referral.created", reasonCode: "PR_CREATED" });
  });

  it("fails closed on an incomplete neutrality record, audited, no referral", () => {
    const store = makeStore();
    const res = store.createReferral({
      organizationId: ORG,
      clientId: "c-grant",
      partnerId: "pt-cedarline-cu",
      neutrality: { ...COMPLETE, whyShown: "", keyRisks: "  " },
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(false);
    expect(res.denialCode).toBe("NEUTRALITY_INCOMPLETE");
    expect(res.missingNeutralityFields).toEqual(["whyShown", "keyRisks"]);
    expect(store.referralsFor(ORG, "c-grant")).toHaveLength(0);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({ action: "partner_referral.denied", reasonCode: "PN_MISSING_FIELDS" });
  });

  it("rejects an unknown partner, an inactive partner, an unknown client, and an unknown actor", () => {
    const store = makeStore();
    const base = { organizationId: ORG, neutrality: COMPLETE, actorStaffId: "s-mercer" };
    expect(store.createReferral({ ...base, clientId: "c-grant", partnerId: "pt-nope" }).denialCode).toBe("PARTNER_NOT_FOUND");
    expect(store.createReferral({ ...base, clientId: "c-grant", partnerId: "pt-oldbridge-lender" }).denialCode).toBe("PARTNER_INACTIVE");
    expect(store.createReferral({ ...base, clientId: "c-nobody", partnerId: "pt-cedarline-cu" }).denialCode).toBe("CLIENT_NOT_FOUND");
    expect(
      store.createReferral({ organizationId: ORG, clientId: "c-grant", partnerId: "pt-cedarline-cu", neutrality: COMPLETE, actorStaffId: "s-ghost" }).denialCode,
    ).toBe("ACTOR_NOT_IN_ORG");
  });
});

describe("transitionReferral", () => {
  it("advances suggested → shared (stamps sharedAt) → engaged", () => {
    const store = makeStore();
    const created = store.createReferral({
      organizationId: ORG,
      clientId: "c-grant",
      partnerId: "pt-cedarline-cu",
      neutrality: COMPLETE,
      actorStaffId: "s-mercer",
    }).referral!;

    const shared = store.transitionReferral({ organizationId: ORG, referralId: created.id, toStatus: "shared_with_client", actorStaffId: "s-mercer" });
    expect(shared.ok).toBe(true);
    expect(shared.referral).toMatchObject({ status: "shared_with_client", sharedAt: NOW.toISOString() });

    const engaged = store.transitionReferral({ organizationId: ORG, referralId: created.id, toStatus: "client_engaged", actorStaffId: "s-mercer" });
    expect(engaged.ok).toBe(true);
    expect(engaged.referral?.status).toBe("client_engaged");
  });

  it("denies an illegal transition, audited, and enforces tenant isolation", () => {
    const store = makeStore();
    // Seeded: pr-solomon-seed is shared_with_client. suggested is unreachable from there.
    const denied = store.transitionReferral({ organizationId: ORG, referralId: "pr-solomon-seed", toStatus: "shared_with_client", actorStaffId: "s-mercer" });
    expect(denied.ok).toBe(false);
    expect(denied.transition?.reasonCode).toBe("PR_SAME_STATUS");
    expect(store.auditFor(ORG).at(-1)?.action).toBe("partner_referral.transition_denied");

    // Wrong org cannot resolve the referral.
    expect(
      store.transitionReferral({ organizationId: "org-other", referralId: "pr-solomon-seed", toStatus: "client_engaged", actorStaffId: "s-mercer" }).denialCode,
    ).toBe("REFERRAL_NOT_FOUND");
  });
});

describe("recordReferralOutcome", () => {
  it("records a staff-observed outcome and reaches the terminal state", () => {
    const store = makeStore();
    const created = store.createReferral({
      organizationId: ORG,
      clientId: "c-grant",
      partnerId: "pt-cedarline-cu",
      neutrality: COMPLETE,
      actorStaffId: "s-mercer",
    }).referral!;
    store.transitionReferral({ organizationId: ORG, referralId: created.id, toStatus: "shared_with_client", actorStaffId: "s-mercer" });
    store.transitionReferral({ organizationId: ORG, referralId: created.id, toStatus: "client_engaged", actorStaffId: "s-mercer" });

    const res = store.recordReferralOutcome({
      organizationId: ORG,
      referralId: created.id,
      outcome: "engaged_supported_readiness",
      note: "Opened a membership and secured the refinance.",
      actorStaffId: "s-mercer",
    });
    expect(res.ok).toBe(true);
    expect(res.referral).toMatchObject({
      status: "outcome_recorded",
      outcome: "engaged_supported_readiness",
      outcomeNote: "Opened a membership and secured the refinance.",
    });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("partner_referral.outcome_recorded");
  });

  it("denies recording an outcome before the client has engaged", () => {
    const store = makeStore();
    // pr-solomon-seed is shared_with_client, not client_engaged.
    const res = store.recordReferralOutcome({ organizationId: ORG, referralId: "pr-solomon-seed", outcome: "not_pursued", actorStaffId: "s-mercer" });
    expect(res.ok).toBe(false);
    expect(res.transition?.reasonCode).toBe("PR_ILLEGAL_TRANSITION");
  });
});

describe("readers", () => {
  it("partnersFor returns only active partners; referralsFor is client-scoped, newest first", () => {
    const store = makeStore();
    const partnerIds = store.partnersFor(ORG).map((p) => p.id);
    expect(partnerIds).toContain("pt-cedarline-cu");
    expect(partnerIds).not.toContain("pt-oldbridge-lender");

    const whitaker = store.referralsFor(ORG, "c-whitaker");
    expect(whitaker.map((r) => r.id)).toEqual(["pr-whitaker-seed"]);
    // Cross-tenant read returns nothing.
    expect(store.referralsFor("org-other", "c-whitaker")).toHaveLength(0);
  });
});
