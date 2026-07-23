import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PLAYBOOK_CONTENT_FIELDS,
  isHighImpactPlaybookContent,
  type FieldProvenance,
  type PlaybookContent,
  type PlaybookContentFieldKey,
} from "@aflo/rules";
import { GOLDEN_KEY_PLAYBOOK_DRAFTS } from "@aflo/shared";

import {
  DrizzlePlaybookRepository,
  MemberNotInOrganizationError,
  PlaybookActionDeniedError,
  PlaybookDirectSupersessionError,
  type PlaybookTransitionActor,
  type PlaybookVersionRecord,
} from "../src/repositories/review-center";

/**
 * Migration 0011 + durable playbook governance proof (ADR-0047, in-memory
 * Postgres under a NON-SUPERUSER role): founder decision 2026-07-23 #2 —
 * author/approver separation, role floors, and the documented single-operator
 * owner override — now enforced at the DURABLE layer via
 * `canActOnPlaybookVersion` inside `DrizzlePlaybookRepository.transitionVersion`,
 * closing the ADR-0043 known gap. Every executed transition appends one
 * `{action, actorMemberId, reasonCode, ownerOverride, occurredAt}` entry to
 * the append-only `review_history` jsonb (ids/codes only); approval and
 * publication stamp the ACTING member; `isAuthor` is derived in-repo and can
 * never be forged; cross-org actors are rejected before anything is written.
 * Applies 0011 ON TOP of 0000–0010 exactly as production would.
 * Credential-free (PGlite).
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function allMigrations(): string {
  return readdirSync(migrationsDir)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replaceAll("--> statement-breakpoint", "");
}

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const ORG_B = "00000000-0000-0000-0000-0000000000bb";
/** The single-operator org whose policy PERMITS the documented owner override. */
const ORG_C = "00000000-0000-0000-0000-0000000000cc";
const NOW = new Date("2026-07-23T12:00:00.000Z");
const LATER = new Date("2026-07-23T13:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let repo: DrizzlePlaybookRepository;
let staffA = "";
let staff2A = "";
let adminA = "";
let ownerA = "";
let owner2A = "";
let memberB = "";
let ownerC = "";

const seed = GOLDEN_KEY_PLAYBOOK_DRAFTS[0]!;

/** The seed's content with every provenance resolved — approvable, HIGH-impact. */
function resolvedContent(): PlaybookContent {
  return {
    ...seed.content,
    fieldProvenance: Object.fromEntries(PLAYBOOK_CONTENT_FIELDS.map((f) => [f, "confirmed"])) as Record<
      PlaybookContentFieldKey,
      FieldProvenance
    >,
  };
}

function actor(memberId: string, role: string): PlaybookTransitionActor {
  return { memberId, role };
}

/** Snapshot the fields a DENIED transition must leave untouched. */
function governanceFields(v: PlaybookVersionRecord) {
  return {
    status: v.status,
    approverMemberId: v.approverMemberId,
    approvedAt: v.approvedAt,
    publishedByMemberId: v.publishedByMemberId,
    historyLength: v.reviewHistory.length,
    updatedAt: v.updatedAt,
  };
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
    INSERT INTO organizations (id, name, slug, allow_single_operator_playbook_override) VALUES
      ('${ORG_C}', 'Org C', 'org-c', true);
  `);
  const users = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES
       ('staff-a@x.co','SA'), ('staff2-a@x.co','S2'), ('admin-a@x.co','AA'),
       ('owner-a@x.co','OA'), ('owner2-a@x.co','O2'), ('b@x.co','B'), ('owner-c@x.co','OC')
     RETURNING id`,
  );
  const members = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES
       ('${ORG_A}', '${users.rows[0]!.id}', 'staff'),
       ('${ORG_A}', '${users.rows[1]!.id}', 'staff'),
       ('${ORG_A}', '${users.rows[2]!.id}', 'organization_admin'),
       ('${ORG_A}', '${users.rows[3]!.id}', 'organization_owner'),
       ('${ORG_A}', '${users.rows[4]!.id}', 'organization_owner'),
       ('${ORG_B}', '${users.rows[5]!.id}', 'staff'),
       ('${ORG_C}', '${users.rows[6]!.id}', 'organization_owner')
     RETURNING id`,
  );
  staffA = members.rows[0]!.id;
  staff2A = members.rows[1]!.id;
  adminA = members.rows[2]!.id;
  ownerA = members.rows[3]!.id;
  owner2A = members.rows[4]!.id;
  memberB = members.rows[5]!.id;
  ownerC = members.rows[6]!.id;

  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
  repo = new DrizzlePlaybookRepository(db);
});

afterAll(async () => {
  await pg?.close();
});

describe("migration 0011 — columns, defaults, birth history", () => {
  it("the seed content fixture is HIGH-impact (the separation trigger this suite depends on)", () => {
    expect(isHighImpactPlaybookContent(resolvedContent())).toBe(true);
  });

  it("a fresh draft carries the 'saved' birth entry, no publisher, and default-false org policy", async () => {
    const pb = await repo.createPlaybook(ORG_A, { playbookKey: "gov-birth", name: "Birth" }, NOW);
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), authorMemberId: staffA },
      NOW,
    );
    expect(draft.publishedByMemberId).toBeNull();
    expect(draft.reviewHistory).toEqual([
      {
        action: "saved",
        actorMemberId: staffA,
        reasonCode: "PB_ACTION_ALLOWED",
        ownerOverride: null,
        occurredAt: NOW.toISOString(),
      },
    ]);
    // The org rows created WITHOUT naming the 0011 column read policy FALSE.
    const flags = await pg.query<{ allow: boolean }>(
      `SELECT allow_single_operator_playbook_override AS allow FROM organizations WHERE id = '${ORG_A}'`,
    );
    expect(flags.rows[0]!.allow).toBe(false);
  });
});

describe("founder decision #2, durable — role floors + separation of duties", () => {
  let playbookId = "";
  let v1 = "";

  beforeAll(async () => {
    // The OWNER-AUTHOR trap: ownerA authors v1 of the governance playbook.
    const pb = await repo.createPlaybook(ORG_A, { playbookKey: seed.playbookKey, name: seed.name }, NOW);
    playbookId = pb.id;
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "1.0.0", content: resolvedContent(), authorMemberId: ownerA },
      NOW,
    );
    v1 = draft.id;
    await repo.transitionVersion(ORG_A, v1, "awaiting_review", NOW, actor(ownerA, "organization_owner"));
  });

  it("staff-approve is denied (PB_ROLE_INSUFFICIENT) and NOTHING changes", async () => {
    const before = governanceFields((await repo.getVersionById(ORG_A, v1))!);
    const denied: unknown = await repo
      .transitionVersion(ORG_A, v1, "approved", LATER, actor(staffA, "staff"))
      .catch((err: unknown) => err);
    expect(denied).toBeInstanceOf(PlaybookActionDeniedError);
    expect(denied).toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "approve" });
    expect(governanceFields((await repo.getVersionById(ORG_A, v1))!)).toEqual(before);
  });

  it("a non-reviewer vocabulary (client / auth staff_advisor / garbage) is denied PB_NO_MEMBERSHIP", async () => {
    for (const role of ["client", "partner_viewer", "staff_advisor", "garbage"]) {
      await expect(
        repo.transitionVersion(ORG_A, v1, "approved", LATER, actor(adminA, role)),
      ).rejects.toMatchObject({ name: "PlaybookActionDeniedError", reasonCode: "PB_NO_MEMBERSHIP" });
    }
  });

  it("HIGH-impact self-approval by the author is denied (PB_AUTHOR_APPROVER_SEPARATION), even for the owner", async () => {
    await expect(
      repo.transitionVersion(ORG_A, v1, "approved", LATER, actor(ownerA, "organization_owner")),
    ).rejects.toMatchObject({ reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
  });

  it("the owner override WITHOUT the org policy flag is denied (PB_OVERRIDE_NOT_PERMITTED)", async () => {
    await expect(
      repo.transitionVersion(ORG_A, v1, "approved", LATER, actor(ownerA, "organization_owner"), {
        ownerOverride: { reason: "Sole operator this week", attestsNotRegulatedAdvice: true },
      }),
    ).rejects.toMatchObject({ reasonCode: "PB_OVERRIDE_NOT_PERMITTED" });
    expect((await repo.getVersionById(ORG_A, v1))!.status).toBe("awaiting_review");
  });

  it("admin-approve is allowed and the approver is stamped FROM the actor", async () => {
    const approved = await repo.transitionVersion(
      ORG_A,
      v1,
      "approved",
      NOW,
      actor(adminA, "organization_admin"),
    );
    expect(approved.status).toBe("approved");
    expect(approved.approverMemberId).toBe(adminA);
    expect(approved.approvedAt).toBe(NOW.toISOString());
    expect(approved.reviewHistory.at(-1)).toEqual({
      action: "approved",
      actorMemberId: adminA,
      reasonCode: "PB_APPROVED",
      ownerOverride: null,
      occurredAt: NOW.toISOString(),
    });
  });

  it("the AUTHOR may never publish their own version (PB_AUTHOR_PUBLISHER_SEPARATION) — no row change", async () => {
    const before = governanceFields((await repo.getVersionById(ORG_A, v1))!);
    await expect(
      repo.transitionVersion(ORG_A, v1, "published", LATER, actor(ownerA, "organization_owner")),
    ).rejects.toMatchObject({ reasonCode: "PB_AUTHOR_PUBLISHER_SEPARATION" });
    expect(governanceFields((await repo.getVersionById(ORG_A, v1))!)).toEqual(before);
  });

  it("a FORGED isAuthor claim is impossible — authorship is derived in-repo from author_member_id", async () => {
    // The type forbids isAuthor (`isAuthor?: never`); even a caller that
    // smuggles the claim past the compiler is ignored — the repository
    // compares the actor to the STORED author and still denies.
    const forged = { memberId: ownerA, role: "organization_owner", isAuthor: false } as unknown as
      PlaybookTransitionActor;
    await expect(repo.transitionVersion(ORG_A, v1, "published", LATER, forged)).rejects.toMatchObject({
      reasonCode: "PB_AUTHOR_PUBLISHER_SEPARATION",
    });
  });

  it("admin-publish is denied (publish is organization_owner ONLY)", async () => {
    await expect(
      repo.transitionVersion(ORG_A, v1, "published", LATER, actor(adminA, "organization_admin")),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT" });
  });

  it("a NON-author owner publishes: publisher stamped + history entry appended with the reason code", async () => {
    const published = await repo.transitionVersion(
      ORG_A,
      v1,
      "published",
      LATER,
      actor(owner2A, "organization_owner"),
    );
    expect(published.status).toBe("published");
    expect(published.publishedByMemberId).toBe(owner2A);
    expect(published.reviewHistory.at(-1)).toEqual({
      action: "published",
      actorMemberId: owner2A,
      reasonCode: "PB_PUBLISHED",
      ownerOverride: null,
      occurredAt: LATER.toISOString(),
    });
    // Append-only: saved → submitted → approved → published, nothing rewritten.
    expect(published.reviewHistory.map((h) => h.action)).toEqual([
      "saved",
      "submitted",
      "approved",
      "published",
    ]);
  });

  it("publishing v2 appends a 'superseded' history entry to v1 in the SAME transaction", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "2.0.0", content: resolvedContent(), authorMemberId: staffA },
      LATER,
    );
    await repo.transitionVersion(ORG_A, draft.id, "awaiting_review", LATER, actor(staffA, "staff"));
    await repo.transitionVersion(ORG_A, draft.id, "approved", LATER, actor(adminA, "organization_admin"));
    await repo.transitionVersion(ORG_A, draft.id, "published", LATER, actor(owner2A, "organization_owner"));
    const v1After = (await repo.getVersionById(ORG_A, v1))!;
    expect(v1After.status).toBe("superseded");
    expect(v1After.reviewHistory.at(-1)).toEqual({
      action: "superseded",
      actorMemberId: owner2A,
      reasonCode: "PB_SUPERSEDED",
      ownerOverride: null,
      occurredAt: LATER.toISOString(),
    });
    expect((await repo.getByKey(ORG_A, seed.playbookKey))!.currentVersionId).toBe(draft.id);
  });

  it("reject/defer are reviewer decisions: staff denied, admin allowed (history records the decision)", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "3.0.0", content: resolvedContent(), authorMemberId: staffA },
      LATER,
    );
    await repo.transitionVersion(ORG_A, draft.id, "awaiting_review", LATER, actor(staffA, "staff"));
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "rejected", LATER, actor(staff2A, "staff")),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "reject" });
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "deferred", LATER, actor(staff2A, "staff")),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "defer" });
    const rejected = await repo.transitionVersion(
      ORG_A,
      draft.id,
      "rejected",
      LATER,
      actor(adminA, "organization_admin"),
    );
    expect(rejected.reviewHistory.at(-1)).toMatchObject({
      action: "rejected",
      actorMemberId: adminA,
      reasonCode: "PB_REJECTED",
    });
  });

  it("withdraw is the author or organization_admin+ — a non-author staff member is denied", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "4.0.0", content: resolvedContent(), authorMemberId: staffA },
      LATER,
    );
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "withdrawn", LATER, actor(staff2A, "staff")),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "withdraw" });
    const withdrawn = await repo.transitionVersion(ORG_A, draft.id, "withdrawn", LATER, actor(staffA, "staff"));
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.reviewHistory.at(-1)).toMatchObject({ action: "withdrawn", actorMemberId: staffA });
  });

  it("direct supersession is NOT a transition surface — publish a newer version instead", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "5.0.0", content: resolvedContent(), authorMemberId: staffA },
      LATER,
    );
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "superseded", LATER, actor(adminA, "organization_admin")),
    ).rejects.toBeInstanceOf(PlaybookDirectSupersessionError);
    expect((await repo.getVersionById(ORG_A, draft.id))!.status).toBe("draft");
  });

  it("a CROSS-ORG actor memberId is rejected before anything is written (the F1 idiom)", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "6.0.0", content: resolvedContent(), authorMemberId: staffA },
      LATER,
    );
    const before = governanceFields((await repo.getVersionById(ORG_A, draft.id))!);
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "awaiting_review", LATER, actor(memberB, "staff")),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    expect(governanceFields((await repo.getVersionById(ORG_A, draft.id))!)).toEqual(before);
  });
});

describe("the documented single-operator owner override (org policy PERMITS — ORG_C)", () => {
  let versionId = "";

  beforeAll(async () => {
    const pb = await repo.createPlaybook(ORG_C, { playbookKey: seed.playbookKey, name: seed.name }, NOW);
    const draft = await repo.saveDraftVersion(
      ORG_C,
      { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), authorMemberId: ownerC },
      NOW,
    );
    versionId = draft.id;
    await repo.transitionVersion(ORG_C, versionId, "awaiting_review", NOW, actor(ownerC, "organization_owner"));
  });

  it("without the override the separation rules still deny the owner-author", async () => {
    await expect(
      repo.transitionVersion(ORG_C, versionId, "approved", NOW, actor(ownerC, "organization_owner")),
    ).rejects.toMatchObject({ reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
  });

  it("an override with a BLANK reason is denied even with the policy flag on", async () => {
    await expect(
      repo.transitionVersion(ORG_C, versionId, "approved", NOW, actor(ownerC, "organization_owner"), {
        ownerOverride: { reason: "   ", attestsNotRegulatedAdvice: true },
      }),
    ).rejects.toMatchObject({ reasonCode: "PB_OVERRIDE_REASON_REQUIRED" });
  });

  it("a complete override (flag + reason + attestation) succeeds and is VISIBLE in review_history", async () => {
    const reason = "Sole authorized operator; content is generic education";
    const approved = await repo.transitionVersion(
      ORG_C,
      versionId,
      "approved",
      NOW,
      actor(ownerC, "organization_owner"),
      { ownerOverride: { reason, attestsNotRegulatedAdvice: true } },
    );
    expect(approved.status).toBe("approved");
    expect(approved.approverMemberId).toBe(ownerC);
    expect(approved.reviewHistory.at(-1)).toEqual({
      action: "approved",
      actorMemberId: ownerC,
      reasonCode: "PB_OWNER_OVERRIDE",
      ownerOverride: { reason },
      occurredAt: NOW.toISOString(),
    });

    // The owner-author PUBLISH rides the same documented override.
    const published = await repo.transitionVersion(
      ORG_C,
      versionId,
      "published",
      LATER,
      actor(ownerC, "organization_owner"),
      { ownerOverride: { reason, attestsNotRegulatedAdvice: true } },
    );
    expect(published.publishedByMemberId).toBe(ownerC);
    expect(published.reviewHistory.at(-1)).toEqual({
      action: "published",
      actorMemberId: ownerC,
      reasonCode: "PB_OWNER_OVERRIDE",
      ownerOverride: { reason },
      occurredAt: LATER.toISOString(),
    });
    // Append-only end to end: every prior entry is still present, in order.
    expect(published.reviewHistory.map((h) => h.action)).toEqual([
      "saved",
      "submitted",
      "approved",
      "published",
    ]);
  });
});
