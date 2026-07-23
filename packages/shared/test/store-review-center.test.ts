import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  AfloStore,
  reviewerRoleForMemberRole,
  type ClientPublishedReviewView,
  type CreateReviewItemInput,
} from "../src/store";
import { syntheticDatabase } from "../src/data/synthetic";

/**
 * Store wiring for the Human Review Center (Workstream A PR-5, ADR-0043):
 * blocked-envelope gate, the founder's ORG-SCOPED open-review 5-tuple
 * uniqueness, kernel-decided transitions/decisions with audited denials, the
 * publication role floor + STALE-ARTIFACT invariant with the supersession
 * recovery path, outcome tracking, the role bridge (§6 trap), the client-safe
 * projection's structural exclusions, and the analytics derivation contract.
 */

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-23T12:00:00.000Z");
const DIGEST = "d".repeat(64);

function makeStore() {
  return new AfloStore(syntheticDatabase, () => NOW);
}

function draftInput(overrides: Partial<CreateReviewItemInput> = {}): CreateReviewItemInput {
  return {
    organizationId: ORG,
    clientId: "c-whitaker",
    artifactType: "roadmap_draft" as const,
    artifactId: "r-c-whitaker",
    artifactVersion: "2",
    artifactDigest: DIGEST,
    actorStaffId: "s-boyd",
    ...overrides,
  };
}

describe("seed integrity — valid versions/digests across states and queues", () => {
  it("every seeded item's digest IS the sha256 of its canonical synthetic string", () => {
    expect(syntheticDatabase.reviewItems.length).toBeGreaterThanOrEqual(6);
    for (const item of syntheticDatabase.reviewItems) {
      const canonical = `AFLO-SYNTHETIC-ARTIFACT::${item.artifactId}::v${item.artifactVersion}`;
      expect(item.artifactDigest, item.id).toBe(createHash("sha256").update(canonical).digest("hex"));
    }
  });

  it("covers several states and queues, and decided items agree with the decision log", () => {
    const states = new Set(syntheticDatabase.reviewItems.map((i) => i.state));
    for (const s of ["draft", "awaiting_review", "approved", "published", "rejected"]) {
      expect([...states], s).toContain(s);
    }
    const types = new Set(syntheticDatabase.reviewItems.map((i) => i.artifactType));
    expect(types.size).toBeGreaterThanOrEqual(5);
    for (const decision of syntheticDatabase.reviewDecisions) {
      const item = syntheticDatabase.reviewItems.find((i) => i.id === decision.reviewItemId);
      expect(item, decision.id).toBeDefined();
      expect(item!.submittedAt, decision.id).not.toBeNull();
    }
  });
});

describe("role bridge (§6) + platform-admin structural exclusion", () => {
  it("maps member roles onto ReviewerRole; every other vocabulary maps to null", () => {
    expect(reviewerRoleForMemberRole("staff")).toBe("staff");
    expect(reviewerRoleForMemberRole("organization_admin")).toBe("organization_admin");
    expect(reviewerRoleForMemberRole("organization_owner")).toBe("organization_owner");
    for (const other of ["staff_advisor", "client", "partner_viewer", "platform_admin", ""]) {
      expect(reviewerRoleForMemberRole(other), other).toBeNull();
    }
  });

  it("platform admin holds no tenant membership — structurally excluded from decisions AND publication", () => {
    const store = makeStore();
    const decide = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      actorStaffId: "platform-admin-1",
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
    });
    expect(decide).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    const item = store.database().reviewItems.find((i) => i.id === "rvi-solomon-report")!;
    const publish = store.publishReviewItem({
      organizationId: ORG,
      reviewItemId: item.id,
      actorStaffId: "platform-admin-1",
      currentArtifactVersion: item.artifactVersion,
      currentArtifactDigest: item.artifactDigest,
    });
    expect(publish).toMatchObject({ ok: false, denialCode: "ACTOR_NOT_IN_ORG" });
    expect(store.database().reviewItems.find((i) => i.id === "rvi-solomon-report")!.state).toBe("approved");
  });
});

describe("createReviewItem — gates before anything is written", () => {
  it("creates a draft with the kernel policy floor stamped (caller values can only RAISE)", () => {
    const store = makeStore();
    // roadmap_draft floor is high/staff; a caller trying to lower is clamped.
    const res = store.createReviewItem(
      draftInput({ riskClassification: "low", requiredReviewerRole: "staff" }),
    );
    expect(res.ok).toBe(true);
    expect(res.item).toMatchObject({
      state: "draft",
      riskClassification: "high",
      requiredReviewerRole: "staff",
      workflowType: "roadmap_draft", // defaults to artifactType
      createdByStaffId: "s-boyd",
      submittedAt: null,
    });
    expect(res.emittedEventIds).toHaveLength(1);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({ action: "review.created", targetId: res.item!.id });
  });

  it("BLOCKED ENVELOPE: prohibited_actions_detected non-empty → audited denial, item NEVER created", () => {
    const store = makeStore();
    const before = store.database().reviewItems.length;
    const res = store.createReviewItem(
      draftInput({ prohibitedActionsDetected: ["guarantee_score_change"] }),
    );
    expect(res).toMatchObject({ ok: false, denialCode: "BLOCKED_ENVELOPE", reasonCode: "RVC_BLOCKED_ENVELOPE" });
    expect(store.database().reviewItems).toHaveLength(before); // no queue entry, ever
    expect(res.emittedEventIds).toEqual([]);
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "review.creation_denied",
      reasonCode: "RVC_BLOCKED_ENVELOPE",
    });
  });

  it("enforces the ORG-SCOPED open 5-tuple: same tuple denied; new version/workflow allowed; terminal frees the slot", () => {
    const store = makeStore();
    expect(store.createReviewItem(draftInput()).ok).toBe(true);
    // Same (org, type, id, version, workflow) while open → denied + audited.
    const dup = store.createReviewItem(draftInput());
    expect(dup).toMatchObject({ ok: false, denialCode: "OPEN_REVIEW_EXISTS" });
    expect(store.auditFor(ORG).at(-1)?.reasonCode).toBe("OPEN_REVIEW_EXISTS");
    // A NEW artifact version requires (and gets) a new review — tuple differs.
    expect(store.createReviewItem(draftInput({ artifactVersion: "3" })).ok).toBe(true);
    // A different workflow dimension differs too.
    expect(store.createReviewItem(draftInput({ workflowType: "client_communication" })).ok).toBe(true);
    // Terminal items do not hold the slot: the seeded REJECTED docint tuple is free.
    const rejected = syntheticDatabase.reviewItems.find((i) => i.id === "rvi-whitaker-docint")!;
    const successor = store.createReviewItem({
      organizationId: ORG,
      clientId: rejected.clientId,
      artifactType: rejected.artifactType,
      artifactId: rejected.artifactId,
      artifactVersion: rejected.artifactVersion,
      artifactDigest: rejected.artifactDigest,
      previousReviewItemId: rejected.id,
      state: "awaiting_review",
      actorStaffId: "s-boyd",
    });
    expect(successor.ok).toBe(true);
    expect(successor.item!.previousReviewItemId).toBe(rejected.id);
    expect(successor.item!.submittedAt).toBe(NOW.toISOString()); // direct-to-queue IS the submission
  });

  it("F4 birth-state gate: a cast can NEVER mint an item directly in approved/published (audited, no row)", () => {
    const store = makeStore();
    const before = store.database().reviewItems.length;
    for (const minted of ["published", "approved", "rejected", "superseded"]) {
      const res = store.createReviewItem(draftInput({ state: minted as "draft" }));
      expect(res, minted).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
      expect(store.auditFor(ORG).at(-1), minted).toMatchObject({
        action: "review.creation_denied",
        reasonCode: "INVALID_INITIAL_STATE",
      });
    }
    expect(store.database().reviewItems).toHaveLength(before); // nothing written
    // The two legal birth states still work (orchestrator direct-to-queue path).
    expect(store.createReviewItem(draftInput({ state: "awaiting_review" })).item!.state).toBe("awaiting_review");
    expect(store.createReviewItem(draftInput({ artifactVersion: "9", state: "draft" })).item!.state).toBe("draft");
  });

  it("clientPublishedReviews NEVER serves an item lacking its publishedAt stamp (no updatedAt fallback)", () => {
    const store = makeStore();
    // Corrupt a copy of the published seed item directly in the live db: state
    // published but no stamp — the projection must fail closed and skip it.
    const published = store.database().reviewItems.find((i) => i.id === "rvi-solomon-education")!;
    store.database().reviewItems.push({
      ...structuredClone(published),
      id: "rvi-corrupted",
      artifactVersion: "99",
      publishedAt: null,
    });
    const rows = store.clientPublishedReviews(ORG, "c-solomon");
    expect(rows.map((r) => r.reviewItemId)).toEqual(["rvi-solomon-education"]);
    expect(rows[0]!.publishedAt).toBe(published.publishedAt); // the real stamp, never updatedAt
  });

  it("validates version/digest shape and org/actor/client scoping fail-closed", () => {
    const store = makeStore();
    expect(store.createReviewItem(draftInput({ artifactVersion: " " }))).toMatchObject({
      ok: false,
      denialCode: "INVALID_INPUT",
    });
    expect(store.createReviewItem(draftInput({ artifactDigest: "ABC" })).denialCode).toBe("INVALID_INPUT");
    expect(store.createReviewItem(draftInput({ organizationId: "org-other" })).denialCode).toBe(
      "ACTOR_NOT_IN_ORG",
    );
    expect(store.createReviewItem(draftInput({ actorStaffId: "s-intruder" })).denialCode).toBe(
      "ACTOR_NOT_IN_ORG",
    );
    expect(store.createReviewItem(draftInput({ clientId: "c-nope" })).denialCode).toBe("CLIENT_NOT_FOUND");
    expect(syntheticDatabase.reviewItems.some((i) => i.artifactId === "r-c-whitaker")).toBe(false); // seed untouched
  });
});

describe("submitReviewItem — the F2 metric anchor", () => {
  it("submits a draft, stamping submittedAt on FIRST queue entry only", () => {
    const store = makeStore();
    const created = store.createReviewItem(draftInput());
    const res = store.submitReviewItem({
      organizationId: ORG,
      reviewItemId: created.item!.id,
      actorStaffId: "s-boyd",
    });
    expect(res.ok).toBe(true);
    expect(res.item!.state).toBe("awaiting_review");
    expect(res.item!.submittedAt).toBe(NOW.toISOString());
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.submitted");
    // Submitting again is a same-state kernel denial — audited, no mutation.
    const again = store.submitReviewItem({
      organizationId: ORG,
      reviewItemId: created.item!.id,
      actorStaffId: "s-boyd",
    });
    expect(again).toMatchObject({ ok: false, reasonCode: "RVC_SAME_STATE" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.transition_denied");
  });
});

describe("assignReviewer — organization_admin+ only (founder matrix)", () => {
  it("staff cannot assign; the owner can; the assignee must hold a reviewer role", () => {
    const store = makeStore();
    const denied = store.assignReviewer({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      reviewerStaffId: "s-lin",
      actorStaffId: "s-boyd",
    });
    expect(denied).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED", reasonCode: "RVC_INSUFFICIENT_ROLE" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.assign_denied");
    const ok = store.assignReviewer({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      reviewerStaffId: "s-lin",
      actorStaffId: "s-mercer",
    });
    expect(ok.ok).toBe(true);
    expect(ok.item!.assignedReviewerStaffId).toBe("s-lin");
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.assigned");
  });
});

describe("recordReviewDecision — THE single decision entry point", () => {
  it("denies high-risk SELF-review (audited) and an insufficient role for an escalated floor", () => {
    const store = makeStore();
    // s-boyd authored the seeded draft roadmap item — cannot review it (high risk).
    store.submitReviewItem({ organizationId: ORG, reviewItemId: "rvi-pryor-roadmap", actorStaffId: "s-boyd" });
    const self = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-pryor-roadmap",
      actorStaffId: "s-boyd",
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
    });
    expect(self).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED", reasonCode: "RVC_SELF_REVIEW_DENIED" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.decision_denied");
    // The seeded financial summary was escalated to the admin floor — staff denied.
    const floor = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-okafor-summary",
      actorStaffId: "s-boyd",
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
    });
    expect(floor).toMatchObject({ ok: false, reasonCode: "RVC_INSUFFICIENT_ROLE" });
    expect(store.database().reviewItems.find((i) => i.id === "rvi-okafor-summary")!.state).toBe("awaiting_review");
  });

  it("appends the decision AND moves the head together; kernel pairing enforced", () => {
    const store = makeStore();
    // approved_with_edits without recorded edits is unrepresentable.
    const missing = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      actorStaffId: "s-mercer",
      decision: "approved_with_edits",
      decisionReasonCode: "RVD_EDITED_TONE",
    });
    expect(missing).toMatchObject({ ok: false, reasonCode: "RVC_MISSING_MODIFICATIONS" });
    expect(store.reviewDecisionsFor(ORG, "rvi-bell-concierge")).toHaveLength(0); // nothing appended on denial
    const res = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      actorStaffId: "s-mercer",
      decision: "approved_with_edits",
      decisionReasonCode: "RVD_EDITED_TONE",
      editedFields: ["summary"],
      modificationsDigest: [{ field: "summary", beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64) }],
      finalOutputSha256: "c".repeat(64),
    });
    expect(res.ok).toBe(true);
    expect(res.item).toMatchObject({
      state: "approved",
      latestDecision: "approved_with_edits",
      latestDecisionReasonCode: "RVD_EDITED_TONE",
      reviewedByStaffId: "s-mercer",
      reviewedAt: NOW.toISOString(),
    });
    expect(res.decision).toMatchObject({
      decision: "approved_with_edits",
      editedFields: ["summary"],
      finalOutputSha256: "c".repeat(64),
    });
    expect(store.reviewDecisionsFor(ORG, "rvi-bell-concierge").map((d) => d.id)).toEqual([res.decision!.id]);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.decided");
  });

  it("escalation raises the floor one rank, stays awaiting_review, and NEVER moves submittedAt", () => {
    const store = makeStore();
    const item = store.database().reviewItems.find((i) => i.id === "rvi-bell-concierge")!;
    const submittedAt = item.submittedAt;
    const res = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: item.id,
      actorStaffId: "s-lin",
      decision: "escalated",
      decisionReasonCode: "RVD_NEEDS_SENIOR_REVIEW",
    });
    expect(res.ok).toBe(true);
    expect(res.item).toMatchObject({
      state: "awaiting_review",
      requiredReviewerRole: "organization_admin",
      reviewedAt: null, // escalation is not a terminal review
    });
    expect(res.item!.submittedAt).toBe(submittedAt); // the F2 anchor
    expect(res.decision!.escalatedToRole).toBe("organization_admin");
  });

  it("deferral records a structured decision; per the kernel, deferred is a terminal state (ADR-0034)", () => {
    const store = makeStore();
    const res = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      actorStaffId: "s-mercer",
      decision: "deferred",
      decisionReasonCode: "RVD_AWAITING_CLIENT_INPUT",
    });
    expect(res.ok).toBe(true);
    expect(res.item!.state).toBe("deferred");
    expect(res.decision!.decision).toBe("deferred");
  });
});

describe("publishReviewItem — role floor + the STALE-ARTIFACT invariant", () => {
  it("staff can NEVER publish a high-risk item; the owner can (matching version+digest)", () => {
    const store = makeStore();
    const item = store.database().reviewItems.find((i) => i.id === "rvi-solomon-report")!;
    const staffTry = store.publishReviewItem({
      organizationId: ORG,
      reviewItemId: item.id,
      actorStaffId: "s-boyd",
      currentArtifactVersion: item.artifactVersion,
      currentArtifactDigest: item.artifactDigest,
    });
    expect(staffTry).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED", reasonCode: "RVC_INSUFFICIENT_ROLE" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.publish_denied");
    const ownerTry = store.publishReviewItem({
      organizationId: ORG,
      reviewItemId: item.id,
      actorStaffId: "s-mercer",
      currentArtifactVersion: item.artifactVersion,
      currentArtifactDigest: item.artifactDigest,
      publishedResultRef: "reports/qr-solomon-q2",
    });
    expect(ownerTry.ok).toBe(true);
    expect(ownerTry.item).toMatchObject({
      state: "published",
      publishedAt: NOW.toISOString(),
      publishedResultRef: "reports/qr-solomon-q2",
    });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.published");
  });

  it("the founder chain verbatim: artifact changes → review stale → prior approval cannot publish → supersede + fresh review", () => {
    const store = makeStore();
    const item = store.database().reviewItems.find((i) => i.id === "rvi-solomon-report")!;
    // The artifact changed after approval — a different digest denies, state stays approved.
    const stale = store.publishReviewItem({
      organizationId: ORG,
      reviewItemId: item.id,
      actorStaffId: "s-mercer",
      currentArtifactVersion: item.artifactVersion,
      currentArtifactDigest: "f".repeat(64),
    });
    expect(stale).toMatchObject({ ok: false, denialCode: "STALE_ARTIFACT", reasonCode: "RVC_STALE_ARTIFACT" });
    expect(store.database().reviewItems.find((i) => i.id === item.id)!.state).toBe("approved"); // NOT published
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "review.publish_denied_stale",
      reasonCode: "RVC_STALE_ARTIFACT",
    });
    // The correct path: supersession + a fresh ReviewItem for the new version
    // (system/orchestrator-invoked — the replacement carries no author).
    const superseded = store.supersedeReviewItem({
      organizationId: ORG,
      reviewItemId: item.id,
      actorStaffId: null,
      replacement: { artifactVersion: "3", artifactDigest: "f".repeat(64) },
    });
    expect(superseded.ok).toBe(true);
    expect(superseded.supersededItem).toMatchObject({
      id: item.id,
      state: "superseded",
      supersededByReviewItemId: superseded.item!.id,
    });
    expect(superseded.item).toMatchObject({
      state: "awaiting_review",
      artifactVersion: "3",
      previousReviewItemId: item.id,
    });
    // Approve the NEW review (system-created — no author, no self-review) and publish against matching facts.
    const approved = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: superseded.item!.id,
      actorStaffId: "s-mercer",
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
    });
    expect(approved.ok).toBe(true);
    const published = store.publishReviewItem({
      organizationId: ORG,
      reviewItemId: superseded.item!.id,
      actorStaffId: "s-mercer",
      currentArtifactVersion: "3",
      currentArtifactDigest: "f".repeat(64),
    });
    expect(published.ok).toBe(true);
    expect(published.item!.state).toBe("published");
  });

  it("publication is only reachable through approved (kernel), audited on denial", () => {
    const store = makeStore();
    const res = store.publishReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge", // awaiting_review
      actorStaffId: "s-mercer",
      currentArtifactVersion: "1",
      currentArtifactDigest: DIGEST,
    });
    expect(res).toMatchObject({ ok: false, reasonCode: "RVC_ILLEGAL_TRANSITION" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.transition_denied");
  });
});

describe("withdrawReviewItem — author or organization_admin+, open states only", () => {
  it("the author withdraws their draft; a non-author staff member cannot; approved cannot be withdrawn", () => {
    const store = makeStore();
    const denied = store.withdrawReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-pryor-roadmap",
      actorStaffId: "s-lin", // staff, not the author
    });
    expect(denied).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.withdraw_denied");
    const ok = store.withdrawReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-pryor-roadmap",
      actorStaffId: "s-boyd", // the author
    });
    expect(ok.ok).toBe(true);
    expect(ok.item!.state).toBe("withdrawn");
    // approved has no withdrawn edge (kernel) — even for the owner.
    const approved = store.withdrawReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-solomon-report",
      actorStaffId: "s-mercer",
    });
    expect(approved).toMatchObject({ ok: false, reasonCode: "RVC_ILLEGAL_TRANSITION" });
  });
});

describe("supersedeReviewItem — human actors need authority (M1)", () => {
  it("staff non-author is denied on an OPEN item (audited); the author is allowed", () => {
    const store = makeStore();
    // rvi-pryor-roadmap is a draft authored by s-boyd.
    const denied = store.supersedeReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-pryor-roadmap",
      actorStaffId: "s-lin",
      replacement: { artifactVersion: "2", artifactDigest: "a".repeat(64) },
    });
    expect(denied).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED", reasonCode: "RVC_INSUFFICIENT_ROLE" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.supersede_denied");
    expect(store.database().reviewItems.find((i) => i.id === "rvi-pryor-roadmap")!.state).toBe("draft");
    const byAuthor = store.supersedeReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-pryor-roadmap",
      actorStaffId: "s-boyd",
      replacement: { artifactVersion: "2", artifactDigest: "a".repeat(64) },
    });
    expect(byAuthor.ok).toBe(true);
    expect(byAuthor.supersededItem!.state).toBe("superseded");
  });

  it("NO staff member — author included — may supersede a PUBLISHED item; admin+ may", () => {
    const store = makeStore();
    // rvi-solomon-education is published and was created by s-lin.
    const authorTry = store.supersedeReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-solomon-education",
      actorStaffId: "s-lin",
      replacement: { artifactVersion: "2", artifactDigest: "b".repeat(64) },
    });
    expect(authorTry).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.supersede_denied");
    expect(store.database().reviewItems.find((i) => i.id === "rvi-solomon-education")!.state).toBe("published");
    const adminTry = store.supersedeReviewItem({
      organizationId: ORG,
      reviewItemId: "rvi-solomon-education",
      actorStaffId: "s-mercer",
      replacement: { artifactVersion: "2", artifactDigest: "b".repeat(64) },
    });
    expect(adminTry.ok).toBe(true);
    expect(adminTry.supersededItem!.state).toBe("superseded");
  });
});

describe("recordReviewDecision — the founder matrix's 'assigned' qualifier (M3, narrowing only)", () => {
  it("on an ASSIGNED item, a non-assignee staff reviewer is denied; the assignee decides", () => {
    const store = makeStore();
    store.assignReviewer({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      reviewerStaffId: "s-lin",
      actorStaffId: "s-mercer",
    });
    // s-boyd passes canReview (staff floor, not the author) but is NOT the assignee.
    const denied = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      actorStaffId: "s-boyd",
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
    });
    expect(denied).toMatchObject({
      ok: false,
      denialCode: "NOT_AUTHORIZED",
      reasonCode: "RVC_NOT_ASSIGNED_REVIEWER",
    });
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "review.decision_denied",
      reasonCode: "RVC_NOT_ASSIGNED_REVIEWER",
    });
    expect(store.reviewDecisionsFor(ORG, "rvi-bell-concierge")).toHaveLength(0);
    const byAssignee = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge",
      actorStaffId: "s-lin",
      decision: "approved_unchanged",
      decisionReasonCode: "RVD_ACCURATE",
    });
    expect(byAssignee.ok).toBe(true);
    expect(byAssignee.item!.state).toBe("approved");
  });

  it("organization_admin+ may decide DESPITE an assignment; unassigned items keep the role-floor behavior", () => {
    const store = makeStore();
    const created = store.createReviewItem(draftInput({ actorStaffId: "s-lin", state: "awaiting_review" }));
    store.assignReviewer({
      organizationId: ORG,
      reviewItemId: created.item!.id,
      reviewerStaffId: "s-boyd",
      actorStaffId: "s-mercer",
    });
    const byOwner = store.recordReviewDecision({
      organizationId: ORG,
      reviewItemId: created.item!.id,
      actorStaffId: "s-mercer", // not the assignee — admin+ overrides the narrowing
      decision: "rejected",
      decisionReasonCode: "RVD_INACCURATE_FACTS",
    });
    expect(byOwner.ok).toBe(true);
    // Unassigned behavior is unchanged — proven throughout this file (e.g. the
    // seeded, unassigned items decided by any floor-qualified reviewer).
  });
});

describe("recordReviewOutcome — measurable outcomes on published items only", () => {
  it("records outcome on the published seed item; denies on a non-published item (audited)", () => {
    const store = makeStore();
    const ok = store.recordReviewOutcome({
      organizationId: ORG,
      reviewItemId: "rvi-solomon-education",
      actorStaffId: "s-lin",
      clientActionStatus: "completed",
      outcome: "achieved",
    });
    expect(ok.ok).toBe(true);
    expect(ok.item!.outcomeRecordedAt).toBe(NOW.toISOString());
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.outcome_recorded");
    const denied = store.recordReviewOutcome({
      organizationId: ORG,
      reviewItemId: "rvi-bell-concierge", // awaiting_review
      actorStaffId: "s-lin",
      clientActionStatus: "completed",
      outcome: "achieved",
    });
    expect(denied).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("review.outcome_denied");
    expect(
      store.recordReviewOutcome({
        organizationId: ORG,
        reviewItemId: "rvi-solomon-education",
        actorStaffId: "s-lin",
        clientActionStatus: "done" as never,
        outcome: "achieved",
      }).denialCode,
    ).toBe("INVALID_INPUT");
  });
});

describe("projections — staff queue vs the client-safe row", () => {
  it("staffReviewQueue filters by state/type/client with full metadata", () => {
    const store = makeStore();
    const awaiting = store.staffReviewQueue(ORG, { state: "awaiting_review" });
    expect(awaiting.map((i) => i.id).sort()).toEqual(["rvi-bell-concierge", "rvi-okafor-summary"]);
    expect(awaiting[0]).toHaveProperty("riskClassification");
    expect(awaiting[0]).toHaveProperty("requiredReviewerRole");
    expect(store.staffReviewQueue(ORG, { clientId: "c-solomon" })).toHaveLength(2);
    expect(store.staffReviewQueue(ORG, { artifactType: "document_interpretation" })).toHaveLength(1);
    expect(store.staffReviewQueue("org-other")).toEqual([]); // tenant isolation
  });

  it("clientPublishedReviews contains ONLY published items and STRUCTURALLY excludes internal fields", () => {
    const store = makeStore();
    const rows = store.clientPublishedReviews(ORG, "c-solomon");
    // c-solomon has an approved report AND a published education item — only the published one appears.
    expect(rows).toHaveLength(1);
    const row = rows[0]!;
    expect(row.reviewItemId).toBe("rvi-solomon-education");
    // The EXACT client-safe key set — nothing else exists on the object at runtime.
    expect(Object.keys(row).sort()).toEqual([
      "artifactId",
      "artifactType",
      "clientActionRef",
      "clientActionStatus",
      "outcome",
      "outcomeRecordedAt",
      "publishedAt",
      "publishedResultRef",
      "reviewItemId",
    ]);
    // Excluded internals are absent as PROPERTIES, not just undefined.
    const forbidden = [
      "state",
      "riskClassification",
      "confidence",
      "requiredReviewerRole",
      "reviewedByStaffId",
      "assignedReviewerStaffId",
      "latestDecision",
      "latestDecisionReasonCode",
      "modificationsDigest",
      "sourceFactSnapshots",
      "createdByStaffId",
      "aiRunId",
      "aiModel",
    ];
    for (const key of forbidden) {
      expect(Object.prototype.hasOwnProperty.call(row, key), key).toBe(false);
    }
    const _typeOnly: ClientPublishedReviewView = row;
    void _typeOnly;
    // Unknown client / wrong org → empty, never a leak.
    expect(store.clientPublishedReviews(ORG, "c-nope")).toEqual([]);
    expect(store.clientPublishedReviews("org-other", "c-solomon")).toEqual([]);
  });
});

describe("reviewMetrics — the ADR-0040 analytics contract, derived from records", () => {
  it("derives decision mixes, queue depth, and outcome rates from the seeds", () => {
    const store = makeStore();
    const metrics = store.reviewMetrics(ORG);
    expect(metrics.overall.total).toBe(4);
    expect(metrics.overall.approvedUnchanged).toBe(1);
    expect(metrics.overall.approvedWithEdits).toBe(1);
    expect(metrics.overall.rejected).toBe(1);
    expect(metrics.overall.escalated).toBe(1);
    expect(metrics.overall.approvalRate).toBe(0.5);
    expect(metrics.escalationVolume).toBe(1);
    expect(metrics.awaitingReviewCount).toBe(2);
    expect(metrics.actionCompletionRate).toBe(1); // the tracked education action completed
    expect(metrics.staffProfiles.map((p) => p.reviewerMemberId)).toEqual(["s-boyd", "s-lin", "s-mercer"]);
    expect(metrics.byArtifactType.quarterly_report?.editRate).toBe(1);
  });
});
