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
  type PlaybookActor,
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
 * publication stamp the ACTING member; BOTH `isAuthor` AND the actor's role
 * are derived from stored rows in the transition transaction (the actor input
 * carries identity only — role laundering and forged authorship are
 * structurally unrepresentable); cross-org actors are rejected before
 * anything is written; executed owner overrides and publishes write
 * `audit_events` rows in the same transaction; the version row is locked
 * FOR UPDATE (lost-update guard, query-text-asserted — the runtime
 * concurrency proof is a Neon-preview acceptance item since PGlite is
 * single-connection). Applies 0011 ON TOP of 0000–0010 exactly as production
 * would. Credential-free (PGlite).
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
let clientA = "";
let partnerA = "";
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

/** Identity-only actor (M1): the repository derives the role from the DB. */
function actor(memberId: string): PlaybookActor {
  return { memberId };
}

/** Set the session-level RLS context for RAW audit-table reads. */
async function useOrg(org: string): Promise<void> {
  await pg.query("SELECT set_config('app.current_org_id', $1, false)", [org]);
}

/** RAW read of the org's playbook audit rows (session-GUC-scoped, reset after). */
async function auditRows(org: string): Promise<{ action: string; actor: string | null; target: string; detail: string | null; reason: string | null }[]> {
  await useOrg(org);
  const rows = await pg.query<{ action: string; actor: string | null; target: string; detail: string | null; reason: string | null }>(
    `SELECT action, actor_member_id::text AS actor, target_id AS target, detail, reason_code AS reason
       FROM audit_events WHERE action LIKE 'playbook.%' ORDER BY occurred_at, id`,
  );
  await pg.exec("RESET app.current_org_id");
  return rows.rows;
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
       ('owner-a@x.co','OA'), ('owner2-a@x.co','O2'), ('b@x.co','B'), ('owner-c@x.co','OC'),
       ('client-a@x.co','CA'), ('partner-a@x.co','PA')
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
       ('${ORG_C}', '${users.rows[6]!.id}', 'organization_owner'),
       ('${ORG_A}', '${users.rows[7]!.id}', 'client'),
       ('${ORG_A}', '${users.rows[8]!.id}', 'partner_viewer')
     RETURNING id`,
  );
  staffA = members.rows[0]!.id;
  staff2A = members.rows[1]!.id;
  adminA = members.rows[2]!.id;
  ownerA = members.rows[3]!.id;
  owner2A = members.rows[4]!.id;
  memberB = members.rows[5]!.id;
  ownerC = members.rows[6]!.id;
  clientA = members.rows[7]!.id;
  partnerA = members.rows[8]!.id;

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
      { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), actor: { memberId: staffA } },
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
      { playbookId, version: "1.0.0", content: resolvedContent(), actor: { memberId: ownerA } },
      NOW,
    );
    v1 = draft.id;
    await repo.transitionVersion(ORG_A, v1, "awaiting_review", NOW, actor(ownerA));
  });

  it("staff-approve is denied (PB_ROLE_INSUFFICIENT) and NOTHING changes", async () => {
    const before = governanceFields((await repo.getVersionById(ORG_A, v1))!);
    const denied: unknown = await repo
      .transitionVersion(ORG_A, v1, "approved", LATER, actor(staffA))
      .catch((err: unknown) => err);
    expect(denied).toBeInstanceOf(PlaybookActionDeniedError);
    expect(denied).toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "approve" });
    expect(governanceFields((await repo.getVersionById(ORG_A, v1))!)).toEqual(before);
  });

  it("a STORED non-reviewer membership (client / partner_viewer) is denied PB_NO_MEMBERSHIP", async () => {
    // M1: the role comes from the organization_members row, so the only way
    // to present a role is to actually hold it — these members exist in
    // org A with non-reviewer roles and are denied by the §6 bridge.
    for (const memberId of [clientA, partnerA]) {
      await expect(
        repo.transitionVersion(ORG_A, v1, "approved", LATER, actor(memberId)),
      ).rejects.toMatchObject({ name: "PlaybookActionDeniedError", reasonCode: "PB_NO_MEMBERSHIP" });
    }
  });

  it("HIGH-impact self-approval by the author is denied (PB_AUTHOR_APPROVER_SEPARATION), even for the owner", async () => {
    await expect(
      repo.transitionVersion(ORG_A, v1, "approved", LATER, actor(ownerA)),
    ).rejects.toMatchObject({ reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
  });

  it("the owner override WITHOUT the org policy flag is denied (PB_OVERRIDE_NOT_PERMITTED)", async () => {
    await expect(
      repo.transitionVersion(ORG_A, v1, "approved", LATER, actor(ownerA), {
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
      actor(adminA),
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
      repo.transitionVersion(ORG_A, v1, "published", LATER, actor(ownerA)),
    ).rejects.toMatchObject({ reasonCode: "PB_AUTHOR_PUBLISHER_SEPARATION" });
    expect(governanceFields((await repo.getVersionById(ORG_A, v1))!)).toEqual(before);
  });

  it("a FORGED isAuthor claim is impossible — authorship is derived in-repo from author_member_id", async () => {
    // The type forbids isAuthor (`isAuthor?: never`); even a caller that
    // smuggles the claim past the compiler is ignored — the repository
    // compares the actor to the STORED author and still denies.
    const forged = { memberId: ownerA, isAuthor: false } as unknown as PlaybookActor;
    await expect(repo.transitionVersion(ORG_A, v1, "published", LATER, forged)).rejects.toMatchObject({
      reasonCode: "PB_AUTHOR_PUBLISHER_SEPARATION",
    });
  });

  it("admin-publish is denied (publish is organization_owner ONLY)", async () => {
    await expect(
      repo.transitionVersion(ORG_A, v1, "published", LATER, actor(adminA)),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT" });
  });

  it("M1: a FORGED role claim is impossible — authority uses the STORED role, and the type carries none", async () => {
    // A staff memberId dressed up as an owner: the input shape has no role
    // field (role?: never), and even a casted claim is never read — the
    // repository denies the (machine-legal) approved→published move from the
    // STORED 'staff' role.
    const laundered = { memberId: staffA, role: "organization_owner" } as unknown as PlaybookActor;
    await expect(repo.transitionVersion(ORG_A, v1, "published", LATER, laundered)).rejects.toMatchObject({
      name: "PlaybookActionDeniedError",
      reasonCode: "PB_ROLE_INSUFFICIENT",
      action: "publish",
    });
  });

  it("a NON-author owner publishes: publisher stamped + history entry appended with the reason code", async () => {
    const published = await repo.transitionVersion(
      ORG_A,
      v1,
      "published",
      LATER,
      actor(owner2A),
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
      { playbookId, version: "2.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      LATER,
    );
    await repo.transitionVersion(ORG_A, draft.id, "awaiting_review", LATER, actor(staffA));
    await repo.transitionVersion(ORG_A, draft.id, "approved", LATER, actor(adminA));
    await repo.transitionVersion(ORG_A, draft.id, "published", LATER, actor(owner2A));
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
      { playbookId, version: "3.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      LATER,
    );
    await repo.transitionVersion(ORG_A, draft.id, "awaiting_review", LATER, actor(staffA));
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "rejected", LATER, actor(staff2A)),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "reject" });
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "deferred", LATER, actor(staff2A)),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "defer" });
    const rejected = await repo.transitionVersion(
      ORG_A,
      draft.id,
      "rejected",
      LATER,
      actor(adminA),
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
      { playbookId, version: "4.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      LATER,
    );
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "withdrawn", LATER, actor(staff2A)),
    ).rejects.toMatchObject({ reasonCode: "PB_ROLE_INSUFFICIENT", action: "withdraw" });
    const withdrawn = await repo.transitionVersion(ORG_A, draft.id, "withdrawn", LATER, actor(staffA));
    expect(withdrawn.status).toBe("withdrawn");
    expect(withdrawn.reviewHistory.at(-1)).toMatchObject({ action: "withdrawn", actorMemberId: staffA });
  });

  it("direct supersession is NOT a transition surface — publish a newer version instead", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "5.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      LATER,
    );
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "superseded", LATER, actor(adminA)),
    ).rejects.toBeInstanceOf(PlaybookDirectSupersessionError);
    expect((await repo.getVersionById(ORG_A, draft.id))!.status).toBe("draft");
  });

  it("a CROSS-ORG actor memberId is rejected before anything is written (the F1 idiom)", async () => {
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "6.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      LATER,
    );
    const before = governanceFields((await repo.getVersionById(ORG_A, draft.id))!);
    await expect(
      repo.transitionVersion(ORG_A, draft.id, "awaiting_review", LATER, actor(memberB)),
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
      { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), actor: { memberId: ownerC } },
      NOW,
    );
    versionId = draft.id;
    await repo.transitionVersion(ORG_C, versionId, "awaiting_review", NOW, actor(ownerC));
  });

  it("without the override the separation rules still deny the owner-author", async () => {
    await expect(
      repo.transitionVersion(ORG_C, versionId, "approved", NOW, actor(ownerC)),
    ).rejects.toMatchObject({ reasonCode: "PB_AUTHOR_APPROVER_SEPARATION" });
  });

  it("an override with a BLANK reason is denied even with the policy flag on", async () => {
    await expect(
      repo.transitionVersion(ORG_C, versionId, "approved", NOW, actor(ownerC), {
        ownerOverride: { reason: "   ", attestsNotRegulatedAdvice: true },
      }),
    ).rejects.toMatchObject({ reasonCode: "PB_OVERRIDE_REASON_REQUIRED" });
  });

  it("an OVER-BOUND reason is denied by the kernel bound the durable layer inherits (L1)", async () => {
    await expect(
      repo.transitionVersion(ORG_C, versionId, "approved", NOW, actor(ownerC), {
        ownerOverride: { reason: "x".repeat(501), attestsNotRegulatedAdvice: true },
      }),
    ).rejects.toMatchObject({ reasonCode: "PB_OVERRIDE_REASON_TOO_LONG" });
    expect((await repo.getVersionById(ORG_C, versionId))!.status).toBe("awaiting_review");
  });

  it("a complete override succeeds; the TRIMMED reason is VISIBLE in review_history (both transitions)", async () => {
    // Padded input proves the clamp: what is stored is the validated value.
    const reason = "  Sole authorized operator; content is generic education  ";
    const trimmed = reason.trim();
    const approved = await repo.transitionVersion(
      ORG_C,
      versionId,
      "approved",
      NOW,
      actor(ownerC),
      { ownerOverride: { reason, attestsNotRegulatedAdvice: true } },
    );
    expect(approved.status).toBe("approved");
    expect(approved.approverMemberId).toBe(ownerC);
    expect(approved.reviewHistory.at(-1)).toEqual({
      action: "approved",
      actorMemberId: ownerC,
      reasonCode: "PB_OWNER_OVERRIDE",
      ownerOverride: { reason: trimmed },
      occurredAt: NOW.toISOString(),
    });

    // The owner-author PUBLISH rides the same documented override.
    const published = await repo.transitionVersion(
      ORG_C,
      versionId,
      "published",
      LATER,
      actor(ownerC),
      { ownerOverride: { reason, attestsNotRegulatedAdvice: true } },
    );
    expect(published.publishedByMemberId).toBe(ownerC);
    expect(published.reviewHistory.at(-1)).toEqual({
      action: "published",
      actorMemberId: ownerC,
      reasonCode: "PB_OWNER_OVERRIDE",
      ownerOverride: { reason: trimmed },
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

  it("F-audit: EACH executed override + the publish wrote an audit_events row in the SAME transaction", async () => {
    const rows = await auditRows(ORG_C);
    const overrides = rows.filter((r) => r.action === "playbook.owner_override");
    expect(overrides).toHaveLength(2); // one per executed override (approve + publish)
    for (const row of overrides) {
      expect(row.actor).toBe(ownerC);
      expect(row.target).toBe(versionId);
      expect(row.reason).toBe("PB_OWNER_OVERRIDE");
    }
    // Detail carries ids/codes + the kernel-clamped reason only.
    expect(JSON.parse(overrides[0]!.detail!)).toEqual({
      action: "approve",
      reason: "Sole authorized operator; content is generic education",
    });
    expect(JSON.parse(overrides[1]!.detail!)).toEqual({
      action: "publish",
      reason: "Sole authorized operator; content is generic education",
    });
    const published = rows.filter((r) => r.action === "playbook.version_published");
    expect(published).toHaveLength(1);
    expect(published[0]).toMatchObject({ actor: ownerC, target: versionId, reason: "PB_PUBLISHED" });
    expect(JSON.parse(published[0]!.detail!)).toMatchObject({ version: "1.0.0", supersededVersionId: null });
  });

  it("F-audit: org A's publishes are audited too, incl. the superseded version id", async () => {
    const rows = await auditRows(ORG_A);
    const published = rows.filter((r) => r.action === "playbook.version_published");
    expect(published).toHaveLength(2); // v1 publish + v2 publish (which superseded v1)
    for (const row of published) expect(row.actor).toBe(owner2A);
    // Row order is not deterministic (same-transaction timestamps) — assert as a set:
    // exactly one plain publish (v1) and one superseding publish (v2 → v1).
    const details = published.map((r) => JSON.parse(r.detail!) as { supersededVersionId: string | null });
    const superseding = details.filter((d) => d.supersededVersionId !== null);
    expect(details.filter((d) => d.supersededVersionId === null)).toHaveLength(1);
    expect(superseding).toHaveLength(1);
    // No override was ever executed in org A — denied attempts audit nothing here.
    expect(rows.filter((r) => r.action === "playbook.owner_override")).toHaveLength(0);
  });
});

describe("F-draft — the drafting floor binds durably to the STORED role", () => {
  it("a client (or partner-viewer) membership can never be recorded as a playbook author", async () => {
    const pb = await repo.createPlaybook(ORG_A, { playbookKey: "gov-draft-floor", name: "Floor" }, NOW);
    for (const memberId of [clientA, partnerA]) {
      await expect(
        repo.saveDraftVersion(
          ORG_A,
          { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), actor: { memberId } },
          NOW,
        ),
      ).rejects.toMatchObject({
        name: "PlaybookActionDeniedError",
        reasonCode: "PB_NO_MEMBERSHIP",
        action: "draft",
      });
    }
    expect(await repo.listVersions(ORG_A, pb.id)).toEqual([]); // nothing written
    // A cross-org member cannot author either (F1 idiom, unchanged).
    await expect(
      repo.saveDraftVersion(
        ORG_A,
        { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), actor: { memberId: memberB } },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    // Staff drafts fine (the floor, not a lockout).
    const draft = await repo.saveDraftVersion(
      ORG_A,
      { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      NOW,
    );
    expect(draft.authorMemberId).toBe(staffA);
  });
});

describe("M2 — the version row is locked FOR UPDATE (lost-update guard)", () => {
  it("the transition SELECTs (version load + prior-published scan) carry FOR UPDATE", async () => {
    // PGlite is single-connection, so a true two-transaction interleaving
    // cannot run here; the lock CLAUSE is asserted via a query-text spy and
    // the runtime concurrency proof is a Neon-preview acceptance item
    // (ADR-0047).
    const logged: string[] = [];
    const spyDb = drizzle(pg, {
      logger: { logQuery: (query: string) => void logged.push(query) },
    });
    const spyRepo = new DrizzlePlaybookRepository(spyDb);
    const pb = await spyRepo.createPlaybook(ORG_A, { playbookKey: "gov-lock", name: "Lock" }, NOW);
    const draft = await spyRepo.saveDraftVersion(
      ORG_A,
      { playbookId: pb.id, version: "1.0.0", content: resolvedContent(), actor: { memberId: staffA } },
      NOW,
    );
    await spyRepo.transitionVersion(ORG_A, draft.id, "awaiting_review", NOW, actor(staffA));
    await spyRepo.transitionVersion(ORG_A, draft.id, "approved", NOW, actor(adminA));

    const lockSelects = logged.filter(
      (q) => /^select /i.test(q) && q.includes('"playbook_versions"') && /for update\s*$/i.test(q),
    );
    // Version-row load is locked on every transition (submit + approve here).
    expect(lockSelects.filter((q) => /limit/i.test(q)).length).toBeGreaterThanOrEqual(2);

    logged.length = 0;
    await spyRepo.transitionVersion(ORG_A, draft.id, "published", NOW, actor(owner2A));
    const publishLockSelects = logged.filter(
      (q) => /^select /i.test(q) && q.includes('"playbook_versions"') && /for update\s*$/i.test(q),
    );
    // Publish locks BOTH the version row (limit 1) and the prior-published scan.
    expect(publishLockSelects.filter((q) => /limit/i.test(q)).length).toBeGreaterThanOrEqual(1);
    expect(publishLockSelects.filter((q) => !/limit/i.test(q)).length).toBeGreaterThanOrEqual(1);
  });
});
