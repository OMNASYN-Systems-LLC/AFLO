import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  PLAYBOOK_CONTENT_FIELDS,
  REVIEW_CENTER_RULES_VERSION,
  type FieldProvenance,
  type PlaybookContent,
  type PlaybookContentFieldKey,
  type ReviewItemState,
} from "@aflo/rules";
import { GOLDEN_KEY_PLAYBOOK_DRAFTS } from "@aflo/shared";

import {
  AiRunNotInOrganizationError,
  DrizzlePlaybookRepository,
  DrizzleReviewDecisionRepository,
  DrizzleReviewItemRepository,
  DrizzleWorkflowDiscoveryRepository,
  InvalidInitialReviewStateError,
  InvalidPlaybookContentError,
  MemberNotInOrganizationError,
  OpenReviewItemExistsError,
  PlaybookApprovalBlockedError,
  PlaybookNotFoundError,
  PlaybookTransitionDeniedError,
  ReviewClientNotInOrganizationError,
  ReviewItemNotFoundError,
  WorkflowDiscoveryInputError,
  WorkflowDiscoveryTransitionDeniedError,
} from "../src/repositories/review-center";

/**
 * Integration proof (in-memory Postgres, non-superuser role) for migration
 * 0009 + the Review Center / Playbook / Discovery repositories:
 *  - per-table RLS isolation across all five tables (cross-org invisibility
 *    through the repositories + raw fail-closed on an unset context),
 *  - the open-review partial unique (at most one OPEN item per artifact;
 *    closed items free the slot),
 *  - append-only decisions (the repository exposes NO update/delete surface),
 *  - the ADR-0038 enforcement boundary: a version whose content still carries
 *    `discovery_required` fields (every Golden Key seed) can NEVER be
 *    approved/published,
 *  - publish–supersede–head-move atomicity (one transaction; a denied publish
 *    changes nothing),
 *  - the workflow-discovery lifecycle with answer/version bookkeeping.
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
const NOW = new Date("2026-07-23T12:00:00.000Z");
const LATER = new Date("2026-07-23T13:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let items: DrizzleReviewItemRepository;
let decisions: DrizzleReviewDecisionRepository;
let playbookRepo: DrizzlePlaybookRepository;
let discovery: DrizzleWorkflowDiscoveryRepository;
let clientA = "";
let clientB = "";
let memberA = "";
let memberB = "";

const seed = GOLDEN_KEY_PLAYBOOK_DRAFTS[0]!;

/** The seed's content with every provenance resolved — approvable fixture. */
function resolvedContent(): PlaybookContent {
  return {
    ...seed.content,
    fieldProvenance: Object.fromEntries(PLAYBOOK_CONTENT_FIELDS.map((f) => [f, "confirmed"])) as Record<
      PlaybookContentFieldKey,
      FieldProvenance
    >,
  };
}

async function useOrg(org: string): Promise<void> {
  await pg.query("SELECT set_config('app.current_org_id', $1, false)", [org]);
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
  `);
  const clients = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES
       ('${ORG_A}','stage-new','Al','A'), ('${ORG_B}','stage-new','Bo','B') RETURNING id`,
  );
  clientA = clients.rows[0]!.id;
  clientB = clients.rows[1]!.id;
  const users = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('a@x.co','A'), ('b@x.co','B') RETURNING id`,
  );
  const members = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES
       ('${ORG_A}', '${users.rows[0]!.id}', 'staff'),
       ('${ORG_B}', '${users.rows[1]!.id}', 'staff') RETURNING id`,
  );
  memberA = members.rows[0]!.id;
  memberB = members.rows[1]!.id;

  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
  items = new DrizzleReviewItemRepository(db);
  decisions = new DrizzleReviewDecisionRepository(db);
  playbookRepo = new DrizzlePlaybookRepository(db);
  discovery = new DrizzleWorkflowDiscoveryRepository(db);
});

afterAll(async () => {
  await pg?.close();
});

describe("review items — open-item invariant + provenance persistence", () => {
  let openItemId = "";

  it("creates a draft item carrying provenance identifiers only", async () => {
    const created = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "roadmap_draft",
        artifactId: "roadmap-1",
        sourceFactSnapshots: [{ factId: "credit_profiles.score", asOf: NOW.toISOString() }],
        ruleVersionsUsed: ["roadmap.v1.0.0"],
        riskClassification: "high",
        requiredReviewerRole: "staff",
        createdByMemberId: memberA,
      },
      NOW,
    );
    openItemId = created.id;
    expect(created.state).toBe("draft");
    expect(created.submittedAt).toBeNull();
    expect(created.sourceFactSnapshots).toEqual([
      { factId: "credit_profiles.score", asOf: NOW.toISOString() },
    ]);
    expect(created.confidence).toBeNull(); // deterministic/manual — never "confident"
  });

  it("rejects a SECOND open item for the same artifact (uq_review_items_open)", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          clientId: clientA,
          artifactType: "roadmap_draft",
          artifactId: "roadmap-1",
          riskClassification: "high",
          requiredReviewerRole: "staff",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(OpenReviewItemExistsError);
  });

  it("still rejects while the item is awaiting_review (both open states covered)", async () => {
    const submitted = await items.saveTransition(ORG_A, openItemId, "awaiting_review", NOW);
    expect(submitted.state).toBe("awaiting_review");
    expect(submitted.submittedAt).toBe(NOW.toISOString());
    await expect(
      items.create(
        ORG_A,
        {
          artifactType: "roadmap_draft",
          artifactId: "roadmap-1",
          riskClassification: "high",
          requiredReviewerRole: "staff",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(OpenReviewItemExistsError);
  });

  it("persists a kernel-approved rejection with reviewer bookkeeping, freeing the slot", async () => {
    const rejected = await items.saveTransition(ORG_A, openItemId, "rejected", LATER, {
      reviewedByMemberId: memberA,
      latestDecision: "rejected",
      latestDecisionReasonCode: "RVD_INACCURATE_FACTS",
    });
    expect(rejected.state).toBe("rejected");
    expect(rejected.reviewedByMemberId).toBe(memberA);
    expect(rejected.reviewedAt).toBe(LATER.toISOString());
    expect(rejected.latestDecision).toBe("rejected");

    // The partial unique frees the slot once no item is in an open state: a
    // revised attempt is a NEW item linked via previousReviewItemId.
    const successor = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "roadmap_draft",
        artifactId: "roadmap-1",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        previousReviewItemId: openItemId,
        state: "awaiting_review",
      },
      LATER,
    );
    expect(successor.previousReviewItemId).toBe(openItemId);
    expect(successor.submittedAt).toBe(LATER.toISOString()); // direct-to-queue = submitted
  });

  it("filters the queue by state and artifact type (the queue-index shape)", async () => {
    const awaiting = await items.listByOrg(ORG_A, { artifactType: "roadmap_draft", state: "awaiting_review" });
    expect(awaiting).toHaveLength(1);
    const rejected = await items.listByOrg(ORG_A, { state: "rejected" });
    expect(rejected.map((i) => i.id)).toEqual([openItemId]);
  });

  it("refuses a client reference from ANOTHER org (FK bypasses RLS — guarded)", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          clientId: clientB,
          artifactType: "financial_summary",
          artifactId: "fin-1",
          riskClassification: "high",
          requiredReviewerRole: "staff",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ReviewClientNotInOrganizationError);
  });
});

describe("review decisions — append-only feedback log", () => {
  it("appends decisions and lists them in decided order", async () => {
    const item = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "quarterly_report",
        artifactId: "report-1",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        state: "awaiting_review",
      },
      NOW,
    );
    const first = await decisions.append(
      ORG_A,
      {
        reviewItemId: item.id,
        decision: "deferred",
        reasonCode: "RVD_AWAITING_CLIENT_INPUT",
        ruleVersion: REVIEW_CENTER_RULES_VERSION,
        decidedByMemberId: memberA,
        workflowType: "quarterly_report",
      },
      NOW,
    );
    const second = await decisions.append(
      ORG_A,
      {
        reviewItemId: item.id,
        decision: "approved_with_edits",
        reasonCode: "RVD_EDITED_TONE",
        ruleVersion: REVIEW_CENTER_RULES_VERSION,
        decidedByMemberId: memberA,
        workflowType: "quarterly_report",
        editedFields: ["highlights"],
        finalOutputSha256: "c".repeat(64),
      },
      LATER,
    );
    expect(first.decidedAt).toBe(NOW.toISOString());
    expect(second.editedFields).toEqual(["highlights"]);
    const listed = await decisions.listByItem(ORG_A, item.id);
    expect(listed.map((d) => d.decision)).toEqual(["deferred", "approved_with_edits"]);
  });

  it("exposes NO update or delete surface — append-only by construction", () => {
    const surface = Object.getOwnPropertyNames(Object.getPrototypeOf(decisions)).sort();
    expect(surface).toEqual(["append", "constructor", "listByItem"]);
  });
});

describe("playbooks — blocked approval + atomic publish/supersede", () => {
  let playbookId = "";
  let v1 = "";
  let v2 = "";

  it("creates the playbook identity and reads it by key", async () => {
    const created = await playbookRepo.createPlaybook(
      ORG_A,
      { playbookKey: seed.playbookKey, name: seed.name },
      NOW,
    );
    playbookId = created.id;
    expect(created.currentVersionId).toBeNull();
    expect((await playbookRepo.getByKey(ORG_A, seed.playbookKey))?.id).toBe(playbookId);
  });

  it("rejects structurally invalid content at the draft door", async () => {
    await expect(
      playbookRepo.saveDraftVersion(
        ORG_A,
        {
          playbookId,
          version: "0.0.1",
          content: { ...seed.content, purpose: "  " },
          authorMemberId: memberA,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidPlaybookContentError);
  });

  it("BLOCKS approval of a Golden Key seed draft (discovery_required fields — ADR-0038 made real)", async () => {
    const draft = await playbookRepo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "0.1.0", content: seed.content, authorMemberId: memberA },
      NOW,
    );
    await playbookRepo.transitionVersion(ORG_A, draft.id, "awaiting_review", NOW);
    await expect(playbookRepo.transitionVersion(ORG_A, draft.id, "approved", NOW)).rejects.toBeInstanceOf(
      PlaybookApprovalBlockedError,
    );
    // The version is untouched by the denied move.
    expect((await playbookRepo.getVersionById(ORG_A, draft.id))?.status).toBe("awaiting_review");
  });

  it("publishes v1 through draft → awaiting_review → approved → published", async () => {
    const draft = await playbookRepo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "1.0.0", content: resolvedContent(), authorMemberId: memberA },
      NOW,
    );
    v1 = draft.id;
    await playbookRepo.transitionVersion(ORG_A, v1, "awaiting_review", NOW);
    const approved = await playbookRepo.transitionVersion(ORG_A, v1, "approved", NOW, {
      approverMemberId: memberA,
    });
    expect(approved.approverMemberId).toBe(memberA);
    expect(approved.approvedAt).toBe(NOW.toISOString());
    const published = await playbookRepo.transitionVersion(ORG_A, v1, "published", NOW);
    expect(published.status).toBe("published");
    expect(published.effectiveDate).toBe(NOW.toISOString()); // stamped when unset
    expect((await playbookRepo.getByKey(ORG_A, seed.playbookKey))?.currentVersionId).toBe(v1);
  });

  it("publishing v2 supersedes v1 AND moves the head in one transaction", async () => {
    const draft = await playbookRepo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "2.0.0", content: resolvedContent(), authorMemberId: memberA },
      LATER,
    );
    v2 = draft.id;
    await playbookRepo.transitionVersion(ORG_A, v2, "awaiting_review", LATER);
    await playbookRepo.transitionVersion(ORG_A, v2, "approved", LATER, { approverMemberId: memberA });
    await playbookRepo.transitionVersion(ORG_A, v2, "published", LATER);

    expect((await playbookRepo.getVersionById(ORG_A, v1))?.status).toBe("superseded");
    expect((await playbookRepo.getVersionById(ORG_A, v2))?.status).toBe("published");
    expect((await playbookRepo.getByKey(ORG_A, seed.playbookKey))?.currentVersionId).toBe(v2);
  });

  it("a DENIED publish leaves the published version and the head unchanged", async () => {
    const draft = await playbookRepo.saveDraftVersion(
      ORG_A,
      { playbookId, version: "3.0.0", content: resolvedContent(), authorMemberId: memberA },
      LATER,
    );
    // draft → published does not exist in the kernel: denied, nothing written.
    await expect(playbookRepo.transitionVersion(ORG_A, draft.id, "published", LATER)).rejects.toBeInstanceOf(
      PlaybookTransitionDeniedError,
    );
    expect((await playbookRepo.getVersionById(ORG_A, draft.id))?.status).toBe("draft");
    expect((await playbookRepo.getVersionById(ORG_A, v2))?.status).toBe("published");
    expect((await playbookRepo.getByKey(ORG_A, seed.playbookKey))?.currentVersionId).toBe(v2);
  });

  it("rejects a duplicate (playbook, version) and a duplicate (org, key)", async () => {
    await expect(
      playbookRepo.saveDraftVersion(
        ORG_A,
        { playbookId, version: "1.0.0", content: resolvedContent(), authorMemberId: memberA },
        NOW,
      ),
    ).rejects.toThrow(/already exists/);
    await expect(
      playbookRepo.createPlaybook(ORG_A, { playbookKey: seed.playbookKey, name: "Twin" }, NOW),
    ).rejects.toThrow(/already exists/);
  });
});

describe("workflow discovery — lifecycle with bookkeeping", () => {
  let itemId = "";
  let convertTarget = "";

  it("raises an item from a Golden Key seed question (system-raised, open)", async () => {
    const playbook = await playbookRepo.getByKey(ORG_A, seed.playbookKey);
    convertTarget = playbook!.currentVersionId!;
    const q = seed.discoveryItems[0]!;
    const raised = await discovery.raise(
      ORG_A,
      {
        playbookId: playbook!.id,
        checkpointRef: q.checkpointRef,
        question: q.question,
        context: q.context,
      },
      NOW,
    );
    itemId = raised.id;
    expect(raised.status).toBe("open");
    expect(raised.raisedByMemberId).toBeNull(); // system/seed-raised
  });

  it("denies open → converted (an answer must exist first)", async () => {
    await expect(
      discovery.transition(ORG_A, itemId, "converted", NOW, { convertedPlaybookVersionId: convertTarget }),
    ).rejects.toBeInstanceOf(WorkflowDiscoveryTransitionDeniedError);
  });

  it("requires an answer to move to answered", async () => {
    await expect(discovery.transition(ORG_A, itemId, "answered", NOW)).rejects.toBeInstanceOf(
      WorkflowDiscoveryInputError,
    );
    const answered = await discovery.transition(ORG_A, itemId, "answered", NOW, {
      answer: "The founder's real trigger threshold, recorded verbatim.",
      answeredByMemberId: memberA,
    });
    expect(answered.status).toBe("answered");
    expect(answered.answeredAt).toBe(NOW.toISOString());
  });

  it("converts with the playbook version that absorbed the answer (terminal)", async () => {
    await expect(discovery.transition(ORG_A, itemId, "converted", LATER)).rejects.toBeInstanceOf(
      WorkflowDiscoveryInputError,
    );
    const converted = await discovery.transition(ORG_A, itemId, "converted", LATER, {
      convertedPlaybookVersionId: convertTarget,
    });
    expect(converted.status).toBe("converted");
    expect(converted.convertedPlaybookVersionId).toBe(convertTarget);
    // Terminal: the absorbed answer can never be reopened.
    await expect(discovery.transition(ORG_A, itemId, "open", LATER)).rejects.toBeInstanceOf(
      WorkflowDiscoveryTransitionDeniedError,
    );
  });

  it("supports dismiss → reopen, and filters listByOrg by status", async () => {
    const other = await discovery.raise(ORG_A, { question: "Second question?" }, NOW);
    await discovery.transition(ORG_A, other.id, "dismissed", NOW);
    const reopened = await discovery.transition(ORG_A, other.id, "open", LATER);
    expect(reopened.status).toBe("open");
    const open = await discovery.listByOrg(ORG_A, "open");
    expect(open.map((d) => d.id)).toContain(other.id);
    expect(open.map((d) => d.id)).not.toContain(itemId);
  });
});

describe("RLS isolation across all five tables", () => {
  beforeAll(async () => {
    // Give org B one row per table (through the repositories, under B's context).
    const pb = await playbookRepo.createPlaybook(ORG_B, { playbookKey: "org-b-play", name: "B Play" }, NOW);
    await playbookRepo.saveDraftVersion(
      ORG_B,
      { playbookId: pb.id, version: "1.0.0", content: seed.content, authorMemberId: memberB },
      NOW,
    );
    const item = await items.create(
      ORG_B,
      {
        clientId: clientB,
        artifactType: "financial_summary",
        artifactId: "b-fin-1",
        riskClassification: "medium",
        requiredReviewerRole: "staff",
        state: "awaiting_review",
      },
      NOW,
    );
    await decisions.append(
      ORG_B,
      {
        reviewItemId: item.id,
        decision: "approved_unchanged",
        reasonCode: "RVD_ACCURATE",
        ruleVersion: REVIEW_CENTER_RULES_VERSION,
        decidedByMemberId: memberB,
        workflowType: "financial_summary",
      },
      NOW,
    );
    await discovery.raise(ORG_B, { question: "B-only question?" }, NOW);
  });

  it("org A never sees org B's rows through the repositories (and vice versa)", async () => {
    expect(await items.listByOrg(ORG_A, { artifactType: "financial_summary" })).toEqual([]);
    expect(await playbookRepo.getByKey(ORG_A, "org-b-play")).toBeNull();
    expect(await playbookRepo.getByKey(ORG_B, seed.playbookKey)).toBeNull();
    expect((await discovery.listByOrg(ORG_B)).map((d) => d.question)).toEqual(["B-only question?"]);
    const bItems = await items.listByOrg(ORG_B);
    expect(bItems).toHaveLength(1);
    expect(await decisions.listByItem(ORG_A, bItems[0]!.id)).toEqual([]);
  });

  it("raw per-table isolation: each org context sees only its own rows", async () => {
    const tables = [
      "review_items",
      "review_decisions",
      "playbooks",
      "playbook_versions",
      "workflow_discovery_items",
    ] as const;
    for (const table of tables) {
      await useOrg(ORG_B);
      const b = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(b.rows[0]!.n, table).toBe(1); // exactly the one org-B row
      await useOrg(ORG_A);
      const a = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
      expect(a.rows[0]!.n, table).toBeGreaterThanOrEqual(1);
    }
  });

  it("fails closed: unset and empty contexts expose ZERO rows in every table", async () => {
    for (const context of ["unset", "empty"] as const) {
      if (context === "unset") await pg.exec("RESET app.current_org_id");
      else await useOrg("");
      for (const table of [
        "review_items",
        "review_decisions",
        "playbooks",
        "playbook_versions",
        "workflow_discovery_items",
      ]) {
        const rows = await pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM ${table}`);
        expect(rows.rows[0]!.n, `${table} (${context})`).toBe(0);
      }
    }
  });

  it("write rejection: cannot insert a row for another org", async () => {
    await useOrg(ORG_A);
    await expect(
      pg.query(`INSERT INTO playbooks (organization_id, playbook_key, name) VALUES ($1, 'sneak', 'X')`, [
        ORG_B,
      ]),
    ).rejects.toThrow(/row-level security/i);
  });
});

describe("cross-org reference guards (F1) — FK validation bypasses RLS, the repositories do not", () => {
  let orgBPlaybookId = "";
  let orgBItemId = "";
  let orgBAiRunId = "";
  let orgAAiRunId = "";
  let orgAItemId = "";

  beforeAll(async () => {
    // Org B fixtures (created through the repositories in the RLS block above).
    orgBPlaybookId = (await playbookRepo.getByKey(ORG_B, "org-b-play"))!.id;
    orgBItemId = (await items.listByOrg(ORG_B))[0]!.id;
    // One ai_run per org (raw insert under each org's own RLS context).
    await useOrg(ORG_B);
    const runB = await pg.query<{ id: string }>(
      `INSERT INTO ai_runs (organization_id, client_id, agent_name, agent_version, status, confidence, response_envelope)
       VALUES ('${ORG_B}', '${clientB}', 'roadmap-agent', '1.0.0', 'ok', 0.500, '{}') RETURNING id`,
    );
    orgBAiRunId = runB.rows[0]!.id;
    await useOrg(ORG_A);
    const runA = await pg.query<{ id: string }>(
      `INSERT INTO ai_runs (organization_id, client_id, agent_name, agent_version, status, confidence, response_envelope)
       VALUES ('${ORG_A}', '${clientA}', 'roadmap-agent', '1.0.0', 'ok', 0.500, '{}') RETURNING id`,
    );
    orgAAiRunId = runA.rows[0]!.id;
    // An org-A item the transition/decision PoCs operate on.
    orgAItemId = (
      await items.create(
        ORG_A,
        {
          clientId: clientA,
          artifactType: "document_interpretation",
          artifactId: "f1-target",
          riskClassification: "high",
          requiredReviewerRole: "staff",
        },
        NOW,
      )
    ).id;
  });

  it("create: org B's playbook id → typed error, no row written", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          artifactType: "roadmap_draft",
          artifactId: "f1-pb",
          riskClassification: "high",
          requiredReviewerRole: "staff",
          playbookId: orgBPlaybookId,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(PlaybookNotFoundError);
    expect((await items.listByOrg(ORG_A)).map((i) => i.artifactId)).not.toContain("f1-pb");
  });

  it("create: org B's review item as previousReviewItemId → typed error, no row written", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          artifactType: "roadmap_draft",
          artifactId: "f1-prev",
          riskClassification: "high",
          requiredReviewerRole: "staff",
          previousReviewItemId: orgBItemId,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(ReviewItemNotFoundError);
    expect((await items.listByOrg(ORG_A)).map((i) => i.artifactId)).not.toContain("f1-prev");
  });

  it("create: org B's ai_run id → typed error, no row written", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          artifactType: "roadmap_draft",
          artifactId: "f1-run",
          riskClassification: "high",
          requiredReviewerRole: "staff",
          aiRunId: orgBAiRunId,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AiRunNotInOrganizationError);
    expect((await items.listByOrg(ORG_A)).map((i) => i.artifactId)).not.toContain("f1-run");
  });

  it("create: org B's member as createdByMemberId → typed error, no row written", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          artifactType: "roadmap_draft",
          artifactId: "f1-member",
          riskClassification: "high",
          requiredReviewerRole: "staff",
          createdByMemberId: memberB,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    expect((await items.listByOrg(ORG_A)).map((i) => i.artifactId)).not.toContain("f1-member");
  });

  it("create: SAME-org playbook/previous/ai_run/member references are accepted", async () => {
    const orgAPlaybook = await playbookRepo.getByKey(ORG_A, seed.playbookKey);
    const previous = (await items.listByOrg(ORG_A, { state: "rejected" }))[0]!;
    const created = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "concierge_recommendation",
        artifactId: "f1-ok",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        playbookId: orgAPlaybook!.id,
        previousReviewItemId: previous.id,
        aiRunId: orgAAiRunId,
        createdByMemberId: memberA,
      },
      NOW,
    );
    expect(created.playbookId).toBe(orgAPlaybook!.id);
    expect(created.previousReviewItemId).toBe(previous.id);
    expect(created.aiRunId).toBe(orgAAiRunId);
  });

  it("saveTransition: org B's item as supersededByReviewItemId → typed error, nothing changed", async () => {
    await expect(
      items.saveTransition(ORG_A, orgAItemId, "superseded", LATER, {
        supersededByReviewItemId: orgBItemId,
      }),
    ).rejects.toBeInstanceOf(ReviewItemNotFoundError);
    const after = await items.getById(ORG_A, orgAItemId);
    expect(after!.state).toBe("draft");
    expect(after!.supersededByReviewItemId).toBeNull();
  });

  it("saveTransition: org B's member as reviewedByMemberId → typed error, nothing changed", async () => {
    await expect(
      items.saveTransition(ORG_A, orgAItemId, "approved", LATER, { reviewedByMemberId: memberB }),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    const after = await items.getById(ORG_A, orgAItemId);
    expect(after!.state).toBe("draft");
    expect(after!.reviewedByMemberId).toBeNull();
  });

  it("append: org B's member as decidedByMemberId → typed error, no decision written", async () => {
    await expect(
      decisions.append(
        ORG_A,
        {
          reviewItemId: orgAItemId,
          decision: "approved_unchanged",
          reasonCode: "RVD_ACCURATE",
          ruleVersion: REVIEW_CENTER_RULES_VERSION,
          decidedByMemberId: memberB,
          workflowType: "document_interpretation",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    expect(await decisions.listByItem(ORG_A, orgAItemId)).toEqual([]);
  });

  it("append: org B's ai_run id → typed error, no decision written", async () => {
    await expect(
      decisions.append(
        ORG_A,
        {
          reviewItemId: orgAItemId,
          decision: "approved_unchanged",
          reasonCode: "RVD_ACCURATE",
          ruleVersion: REVIEW_CENTER_RULES_VERSION,
          decidedByMemberId: memberA,
          workflowType: "document_interpretation",
          aiRunId: orgBAiRunId,
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(AiRunNotInOrganizationError);
    expect(await decisions.listByItem(ORG_A, orgAItemId)).toEqual([]);
  });

  it("saveDraftVersion: org B's member as author → typed error, no version written", async () => {
    const orgAPlaybook = await playbookRepo.getByKey(ORG_A, seed.playbookKey);
    const before = (await playbookRepo.listVersions(ORG_A, orgAPlaybook!.id)).length;
    await expect(
      playbookRepo.saveDraftVersion(
        ORG_A,
        { playbookId: orgAPlaybook!.id, version: "9.9.9", content: resolvedContent(), authorMemberId: memberB },
        NOW,
      ),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    expect((await playbookRepo.listVersions(ORG_A, orgAPlaybook!.id)).length).toBe(before);
  });

  it("discovery raise: org B's member as raisedBy → typed error, no row written", async () => {
    const before = (await discovery.listByOrg(ORG_A)).length;
    await expect(
      discovery.raise(ORG_A, { question: "Sneaky?", raisedByMemberId: memberB }, NOW),
    ).rejects.toBeInstanceOf(MemberNotInOrganizationError);
    expect((await discovery.listByOrg(ORG_A)).length).toBe(before);
  });
});

describe("escalation preserves submitted_at (F2) — the review-time metric anchor", () => {
  it("a same-state escalation raises the reviewer floor without re-stamping submitted_at", async () => {
    const created = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "stage_advancement",
        artifactId: "f2-esc",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        state: "awaiting_review",
      },
      NOW,
    );
    expect(created.submittedAt).toBe(NOW.toISOString());
    const escalated = await items.saveTransition(ORG_A, created.id, "awaiting_review", LATER, {
      requiredReviewerRole: "organization_admin",
    });
    expect(escalated.state).toBe("awaiting_review");
    expect(escalated.requiredReviewerRole).toBe("organization_admin");
    // The anchor every review-time median derives from is UNCHANGED.
    expect(escalated.submittedAt).toBe(NOW.toISOString());
    expect(escalated.updatedAt).toBe(LATER.toISOString());
  });
});

describe("atomic decide-and-transition (F3) — head and log move together or not at all", () => {
  it("writes the decision row AND the head change consistently on success", async () => {
    const item = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "financial_summary",
        artifactId: "f3-ok",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        state: "awaiting_review",
      },
      NOW,
    );
    const result = await items.recordDecisionAndTransition(
      ORG_A,
      {
        reviewItemId: item.id,
        decision: "approved_with_edits",
        reasonCode: "RVD_EDITED_TONE",
        ruleVersion: REVIEW_CENTER_RULES_VERSION,
        decidedByMemberId: memberA,
        workflowType: "financial_summary",
        editedFields: ["summary"],
        finalOutputSha256: "d".repeat(64),
        toState: "approved",
        headPatch: {
          modificationsDigest: [
            { field: "summary", beforeSha256: "a".repeat(64), afterSha256: "b".repeat(64) },
          ],
        },
      },
      LATER,
    );
    expect(result.decision.decision).toBe("approved_with_edits");
    expect(result.item.state).toBe("approved");
    expect(result.item.latestDecision).toBe("approved_with_edits");
    expect(result.item.latestDecisionReasonCode).toBe("RVD_EDITED_TONE");
    expect(result.item.reviewedByMemberId).toBe(memberA);
    expect(result.item.reviewedAt).toBe(LATER.toISOString());
    expect((await decisions.listByItem(ORG_A, item.id)).map((d) => d.id)).toEqual([result.decision.id]);
  });

  it("an escalated decision through the atomic path leaves state and submitted_at untouched", async () => {
    const item = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "partner_referral",
        artifactId: "f3-esc",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        state: "awaiting_review",
      },
      NOW,
    );
    const result = await items.recordDecisionAndTransition(
      ORG_A,
      {
        reviewItemId: item.id,
        decision: "escalated",
        reasonCode: "RVD_NEEDS_SENIOR_REVIEW",
        ruleVersion: REVIEW_CENTER_RULES_VERSION,
        decidedByMemberId: memberA,
        workflowType: "partner_referral",
        escalatedToRole: "organization_admin",
        toState: "awaiting_review",
        headPatch: { requiredReviewerRole: "organization_admin" },
      },
      LATER,
    );
    expect(result.item.state).toBe("awaiting_review");
    expect(result.item.requiredReviewerRole).toBe("organization_admin");
    expect(result.item.submittedAt).toBe(NOW.toISOString()); // F2 anchor preserved here too
    expect(result.item.latestDecision).toBe("escalated");
    expect(result.item.reviewedAt).toBeNull(); // escalation is not a terminal review
    expect((await decisions.listByItem(ORG_A, item.id)).map((d) => d.escalatedToRole)).toEqual([
      "organization_admin",
    ]);
  });

  it("a mid-operation failure rolls back BOTH writes (valid decision input, invalid toState)", async () => {
    const item = await items.create(
      ORG_A,
      {
        clientId: clientA,
        artifactType: "client_communication",
        artifactId: "f3-roll",
        riskClassification: "high",
        requiredReviewerRole: "staff",
        state: "awaiting_review",
      },
      NOW,
    );
    await expect(
      items.recordDecisionAndTransition(
        ORG_A,
        {
          reviewItemId: item.id,
          decision: "approved_unchanged",
          reasonCode: "RVD_ACCURATE",
          ruleVersion: REVIEW_CENTER_RULES_VERSION,
          decidedByMemberId: memberA,
          workflowType: "client_communication",
          toState: "not_a_state" as ReviewItemState,
        },
        LATER,
      ),
    ).rejects.toThrow();
    // NEITHER the decision row NOR the head change survives the rollback.
    expect(await decisions.listByItem(ORG_A, item.id)).toEqual([]);
    const after = await items.getById(ORG_A, item.id);
    expect(after!.state).toBe("awaiting_review");
    expect(after!.latestDecision).toBeNull();
    expect(after!.reviewedAt).toBeNull();
  });
});

describe("runtime birth-state assert (F4)", () => {
  it("rejects a cast state 'published' at runtime — no row written", async () => {
    await expect(
      items.create(
        ORG_A,
        {
          artifactType: "roadmap_draft",
          artifactId: "f4-birth",
          riskClassification: "high",
          requiredReviewerRole: "staff",
          state: "published" as unknown as "draft",
        },
        NOW,
      ),
    ).rejects.toBeInstanceOf(InvalidInitialReviewStateError);
    expect((await items.listByOrg(ORG_A)).map((i) => i.artifactId)).not.toContain("f4-birth");
  });
});
