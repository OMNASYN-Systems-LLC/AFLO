import { describe, expect, it } from "vitest";
import {
  PLAYBOOK_CONTENT_FIELDS,
  type FieldProvenance,
  type PlaybookContent,
  type PlaybookContentFieldKey,
} from "@aflo/rules";
import { AfloStore, type PlaybookStoreResult } from "../src/store";
import { syntheticDatabase, type SyntheticDatabase } from "../src/data/synthetic";
import { GOLDEN_KEY_PLAYBOOK_DRAFTS } from "../src/data/playbook-seeds";

/**
 * Store wiring for Professional Playbooks + Workflow Discovery (Workstream A
 * PR-5, ADR-0043): founder decision #2 made operational — author/approver
 * separation with the documented single-operator owner override (recorded in
 * review history + audited), the ADR-0038/0041 contentBlocksApproval boundary
 * (never weakened), atomic publish→supersede→head-move, and the discovery
 * lifecycle with bookkeeping.
 */

const ORG = syntheticDatabase.organization.id;
const NOW = new Date("2026-07-23T12:00:00.000Z");
const seed = GOLDEN_KEY_PLAYBOOK_DRAFTS[0]!;

function makeStore(seedDb: SyntheticDatabase = syntheticDatabase) {
  return new AfloStore(seedDb, () => NOW);
}

/** A seed database clone with the single-operator override policy ENABLED. */
function overrideEnabledSeed(): SyntheticDatabase {
  const db = structuredClone(syntheticDatabase);
  db.organization.allowSingleOperatorPlaybookOverride = true;
  return db;
}

/** The Golden Key seed content with every provenance resolved — approvable. */
function resolvedContent(): PlaybookContent {
  return {
    ...structuredClone(seed.content),
    fieldProvenance: Object.fromEntries(PLAYBOOK_CONTENT_FIELDS.map((f) => [f, "confirmed"])) as Record<
      PlaybookContentFieldKey,
      FieldProvenance
    >,
  };
}

/** createPlaybookDraft + savePlaybookVersion happy path (author = actor). */
function draftVersion(store: AfloStore, actorStaffId: string, content = resolvedContent()): PlaybookStoreResult {
  const pb = store.createPlaybookDraft({
    organizationId: ORG,
    playbookKey: seed.playbookKey,
    name: seed.name,
    actorStaffId,
  });
  expect(pb.ok).toBe(true);
  return store.savePlaybookVersion({
    organizationId: ORG,
    playbookId: pb.playbook!.id,
    version: "1.0.0",
    content,
    actorStaffId,
  });
}

describe("createPlaybookDraft + savePlaybookVersion", () => {
  it("staff drafts a playbook + version; content is validator-gated; keys are org-unique", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd");
    expect(saved.ok).toBe(true);
    expect(saved.version).toMatchObject({ status: "draft", authorStaffId: "s-boyd", version: "1.0.0" });
    expect(saved.version!.reviewHistory.map((h) => h.action)).toEqual(["saved"]);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("playbook.version_saved");
    // Duplicate key denied.
    expect(
      store.createPlaybookDraft({ organizationId: ORG, playbookKey: seed.playbookKey, name: "Twin", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, denialCode: "PLAYBOOK_KEY_EXISTS" });
    // Structurally invalid content never reaches the table.
    const invalid = store.savePlaybookVersion({
      organizationId: ORG,
      playbookId: saved.playbook!.id,
      version: "1.1.0",
      content: { ...resolvedContent(), purpose: "  " },
      actorStaffId: "s-boyd",
    });
    expect(invalid).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
  });

  it("revises a DRAFT in place; a submitted version's content is immutable (VERSION_NOT_DRAFT)", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd");
    const revised = store.savePlaybookVersion({
      organizationId: ORG,
      playbookId: saved.playbook!.id,
      version: "1.0.0",
      content: resolvedContent(),
      actorStaffId: "s-lin",
    });
    expect(revised.ok).toBe(true);
    expect(revised.version!.id).toBe(saved.version!.id);
    expect(revised.version!.reviewHistory.map((h) => h.action)).toEqual(["saved", "saved"]);
    store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: saved.version!.id,
      toStatus: "awaiting_review",
      actorStaffId: "s-boyd",
    });
    expect(
      store.savePlaybookVersion({
        organizationId: ORG,
        playbookId: saved.playbook!.id,
        version: "1.0.0",
        content: resolvedContent(),
        actorStaffId: "s-boyd",
      }),
    ).toMatchObject({ ok: false, denialCode: "VERSION_NOT_DRAFT" });
  });
});

describe("founder decision #2 — role floors and separation of duties", () => {
  it("staff submits but can NEITHER approve NOR publish; the non-author owner can do both", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd");
    const id = saved.version!.id;
    expect(
      store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "awaiting_review", actorStaffId: "s-boyd" }).ok,
    ).toBe(true);
    const staffApprove = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: id,
      toStatus: "approved",
      actorStaffId: "s-lin",
    });
    expect(staffApprove).toMatchObject({ ok: false, denialCode: "NOT_AUTHORIZED", reasonCode: "PB_ROLE_INSUFFICIENT" });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("playbook.transition_denied");
    // The owner (not the author) approves — high-impact separation satisfied.
    const approved = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: id,
      toStatus: "approved",
      actorStaffId: "s-mercer",
    });
    expect(approved.ok).toBe(true);
    expect(approved.version).toMatchObject({ approverStaffId: "s-mercer", approvedAt: NOW.toISOString() });
    // Staff publish denied (owner-only), owner publish succeeds + head moves.
    expect(
      store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "published", actorStaffId: "s-boyd" }),
    ).toMatchObject({ ok: false, reasonCode: "PB_ROLE_INSUFFICIENT" });
    const published = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: id,
      toStatus: "published",
      actorStaffId: "s-mercer",
    });
    expect(published.ok).toBe(true);
    expect(published.version!.status).toBe("published");
    expect(published.version!.effectiveDate).toBe(NOW.toISOString());
    expect(published.playbook!.currentVersionId).toBe(id);
    expect(store.auditFor(ORG).at(-1)?.action).toBe("playbook.version_published");
    expect(published.emittedEventIds).toHaveLength(1);
  });

  it("the OWNER-AUTHOR trap: separation denies self-approval/self-publish without the documented override", () => {
    // Org policy DISABLED (the Golden Key default): override attempts denied.
    const store = makeStore();
    const saved = draftVersion(store, "s-mercer"); // owner authors the version
    const id = saved.version!.id;
    store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "awaiting_review", actorStaffId: "s-mercer" });
    // High-impact (seed checkpoint is high) + author → separation denial.
    expect(
      store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "approved", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
    // Even WITH a complete override, org policy false → PB_OVERRIDE_NOT_PERMITTED.
    expect(
      store.transitionPlaybookVersion({
        organizationId: ORG,
        versionId: id,
        toStatus: "approved",
        actorStaffId: "s-mercer",
        ownerOverride: { reason: "Sole operator this week", attestsNotRegulatedAdvice: true },
      }),
    ).toMatchObject({ ok: false, reasonCode: "PB_OVERRIDE_NOT_PERMITTED" });
  });

  it("the documented single-operator owner override: recorded in review history AND audited", () => {
    const store = makeStore(overrideEnabledSeed());
    const saved = draftVersion(store, "s-mercer");
    const id = saved.version!.id;
    store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "awaiting_review", actorStaffId: "s-mercer" });
    // Missing reason still denied even with policy on.
    expect(
      store.transitionPlaybookVersion({
        organizationId: ORG,
        versionId: id,
        toStatus: "approved",
        actorStaffId: "s-mercer",
        ownerOverride: { reason: "  ", attestsNotRegulatedAdvice: true },
      }),
    ).toMatchObject({ ok: false, reasonCode: "PB_OVERRIDE_REASON_REQUIRED" });
    // Complete override → allowed; visible in review history; audited.
    const approved = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: id,
      toStatus: "approved",
      actorStaffId: "s-mercer",
      ownerOverride: { reason: "Sole authorized operator; content is generic education", attestsNotRegulatedAdvice: true },
    });
    expect(approved.ok).toBe(true);
    const historyEntry = approved.version!.reviewHistory.at(-1)!;
    expect(historyEntry).toMatchObject({
      action: "approved",
      reasonCode: "PB_OWNER_OVERRIDE",
      ownerOverride: { reason: "Sole authorized operator; content is generic education" },
    });
    expect(store.auditFor(ORG).some((a) => a.action === "playbook.owner_override")).toBe(true);
    // Publish (owner-author) rides the same override; the event records it.
    const published = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: id,
      toStatus: "published",
      actorStaffId: "s-mercer",
      ownerOverride: { reason: "Sole authorized operator; content is generic education", attestsNotRegulatedAdvice: true },
    });
    expect(published.ok).toBe(true);
    expect(published.version!.reviewHistory.at(-1)!.ownerOverride).not.toBeNull();
  });
});

describe("review-history entries — the ONE cross-layer contract shape (ADR-0047)", () => {
  it("every entry is exactly {action, actorMemberId, reasonCode, ownerOverride, occurredAt}", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd");
    const id = saved.version!.id;
    store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "awaiting_review", actorStaffId: "s-boyd" });
    const entries = store.database().playbookVersions.find((v) => v.id === id)!.reviewHistory;
    expect(entries.length).toBeGreaterThan(0);
    // The exact key set the DURABLE layer writes to playbook_versions.review_history
    // (DrizzlePlaybookRepository) — one contract, no drift.
    for (const entry of entries) {
      expect(Object.keys(entry).sort()).toEqual([
        "action",
        "actorMemberId",
        "occurredAt",
        "ownerOverride",
        "reasonCode",
      ]);
    }
    expect(entries.at(-1)).toEqual({
      action: "submitted",
      actorMemberId: "s-boyd",
      reasonCode: "PB_SUBMITTED",
      ownerOverride: null,
      occurredAt: NOW.toISOString(),
    });
  });
});

describe("ADR-0038/0041 boundary — contentBlocksApproval on approve AND publish (never weakened)", () => {
  it("a Golden Key seed draft (discovery_required fields) can NEVER be approved, even by the owner", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd", structuredClone(seed.content));
    const id = saved.version!.id;
    store.transitionPlaybookVersion({ organizationId: ORG, versionId: id, toStatus: "awaiting_review", actorStaffId: "s-boyd" });
    const blocked = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: id,
      toStatus: "approved",
      actorStaffId: "s-mercer",
    });
    expect(blocked).toMatchObject({ ok: false, denialCode: "APPROVAL_BLOCKED" });
    expect(blocked.blockedFields!.length).toBeGreaterThan(0);
    expect(store.database().playbookVersions.find((v) => v.id === id)!.status).toBe("awaiting_review");
    expect(store.auditFor(ORG).at(-1)).toMatchObject({
      action: "playbook.transition_denied",
      reasonCode: "APPROVAL_BLOCKED",
    });
  });
});

describe("publish supersedes the prior published version atomically", () => {
  it("v2 publish → v1 superseded (with history entry) + head moved + event carries supersededVersionId", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd");
    const playbookId = saved.playbook!.id;
    const v1 = saved.version!.id;
    for (const toStatus of ["awaiting_review", "approved", "published"] as const) {
      expect(
        store.transitionPlaybookVersion({ organizationId: ORG, versionId: v1, toStatus, actorStaffId: "s-mercer" }).ok,
      ).toBe(true);
    }
    const v2saved = store.savePlaybookVersion({
      organizationId: ORG,
      playbookId,
      version: "2.0.0",
      content: resolvedContent(),
      actorStaffId: "s-boyd",
    });
    const v2 = v2saved.version!.id;
    store.transitionPlaybookVersion({ organizationId: ORG, versionId: v2, toStatus: "awaiting_review", actorStaffId: "s-boyd" });
    store.transitionPlaybookVersion({ organizationId: ORG, versionId: v2, toStatus: "approved", actorStaffId: "s-mercer" });
    const published = store.transitionPlaybookVersion({
      organizationId: ORG,
      versionId: v2,
      toStatus: "published",
      actorStaffId: "s-mercer",
    });
    expect(published.ok).toBe(true);
    const v1After = store.database().playbookVersions.find((v) => v.id === v1)!;
    expect(v1After.status).toBe("superseded");
    expect(v1After.reviewHistory.at(-1)!.action).toBe("superseded");
    expect(store.database().playbooks.find((p) => p.id === playbookId)!.currentVersionId).toBe(v2);
    // Direct supersession is not a store surface — only publishing supersedes.
    expect(
      store.transitionPlaybookVersion({ organizationId: ORG, versionId: v2, toStatus: "superseded", actorStaffId: "s-mercer" }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
  });
});

describe("workflow discovery — raise + resolve with bookkeeping", () => {
  it("system-raises a seed question, answers it (answer required), converts it to a version (org-visible)", () => {
    const store = makeStore();
    const saved = draftVersion(store, "s-boyd");
    const q = seed.discoveryItems[0]!;
    const raised = store.raiseWorkflowDiscoveryItem({
      organizationId: ORG,
      playbookId: saved.playbook!.id,
      checkpointRef: q.checkpointRef,
      question: q.question,
      context: q.context,
      actorStaffId: null, // system/seed-raised
    });
    expect(raised.ok).toBe(true);
    expect(raised.item).toMatchObject({ status: "open", raisedByStaffId: null });
    expect(store.auditFor(ORG).at(-1)?.action).toBe("discovery.raised");
    // open → converted is illegal (an answer must exist first) — audited.
    expect(
      store.resolveWorkflowDiscoveryItem({
        organizationId: ORG,
        itemId: raised.item!.id,
        toStatus: "converted",
        actorStaffId: "s-mercer",
        convertedPlaybookVersionId: saved.version!.id,
      }),
    ).toMatchObject({ ok: false, reasonCode: "WD_ILLEGAL_TRANSITION" });
    // answered requires the answer.
    expect(
      store.resolveWorkflowDiscoveryItem({
        organizationId: ORG,
        itemId: raised.item!.id,
        toStatus: "answered",
        actorStaffId: "s-mercer",
      }),
    ).toMatchObject({ ok: false, denialCode: "INVALID_INPUT" });
    const answered = store.resolveWorkflowDiscoveryItem({
      organizationId: ORG,
      itemId: raised.item!.id,
      toStatus: "answered",
      actorStaffId: "s-mercer",
      answer: "The founder's real trigger threshold, recorded verbatim.",
    });
    expect(answered.ok).toBe(true);
    expect(answered.item).toMatchObject({ answeredByStaffId: "s-mercer", answeredAt: NOW.toISOString() });
    // converted requires an org-visible playbook version.
    expect(
      store.resolveWorkflowDiscoveryItem({
        organizationId: ORG,
        itemId: raised.item!.id,
        toStatus: "converted",
        actorStaffId: "s-mercer",
        convertedPlaybookVersionId: "pbv-elsewhere",
      }),
    ).toMatchObject({ ok: false, denialCode: "VERSION_NOT_FOUND" });
    const converted = store.resolveWorkflowDiscoveryItem({
      organizationId: ORG,
      itemId: raised.item!.id,
      toStatus: "converted",
      actorStaffId: "s-mercer",
      convertedPlaybookVersionId: saved.version!.id,
    });
    expect(converted.ok).toBe(true);
    expect(converted.item!.convertedPlaybookVersionId).toBe(saved.version!.id);
    expect(store.workflowDiscoveryFor(ORG, "converted").map((d) => d.id)).toEqual([raised.item!.id]);
  });

  it("dismiss → reopen works; denials audited; org scoping enforced", () => {
    const store = makeStore();
    const raised = store.raiseWorkflowDiscoveryItem({
      organizationId: ORG,
      question: "Second question?",
      actorStaffId: "s-lin",
    });
    store.resolveWorkflowDiscoveryItem({
      organizationId: ORG,
      itemId: raised.item!.id,
      toStatus: "dismissed",
      actorStaffId: "s-lin",
    });
    const reopened = store.resolveWorkflowDiscoveryItem({
      organizationId: ORG,
      itemId: raised.item!.id,
      toStatus: "open",
      actorStaffId: "s-lin",
    });
    expect(reopened.ok).toBe(true);
    expect(
      store.resolveWorkflowDiscoveryItem({
        organizationId: "org-other",
        itemId: raised.item!.id,
        toStatus: "dismissed",
        actorStaffId: "s-lin",
      }),
    ).toMatchObject({ ok: false, denialCode: "ITEM_NOT_FOUND" });
    expect(store.raiseWorkflowDiscoveryItem({ organizationId: ORG, question: "  ", actorStaffId: "s-lin" })).toMatchObject({
      ok: false,
      denialCode: "INVALID_INPUT",
    });
  });
});
