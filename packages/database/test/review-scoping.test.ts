import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  DrizzleReviewItemRepository,
  InvalidReviewArtifactRefError,
  OpenReviewItemExistsError,
  StaleReviewItemError,
} from "../src/repositories/review-center";

/**
 * Migration 0010 proof (in-memory Postgres, non-superuser role): the
 * ORG-SCOPED open-review 5-tuple uniqueness (founder decision 2026-07-23 #3,
 * verbatim: one active open review per organization_id + artifact_type +
 * artifact_id + artifact_version + workflow_type; terminal reviews do not
 * prevent a new review; a new artifact version requires a new review) and the
 * STALE-ARTIFACT publication invariant (review references artifact version +
 * digest → artifact changes → review becomes stale → prior approval cannot
 * publish changed content → new review required). Applies 0010 ON TOP of
 * 0000–0009 exactly as production would, and guards the snapshot chain (the
 * PR #88 lesson). Credential-free (PGlite).
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
const D1 = "a".repeat(64);
const D2 = "b".repeat(64);

let pg: PGlite;
let db: PgliteDatabase;
let items: DrizzleReviewItemRepository;
let memberA = "";

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
  `);
  const users = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('a@x.co','A') RETURNING id`,
  );
  const members = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES
       ('${ORG_A}', '${users.rows[0]!.id}', 'staff') RETURNING id`,
  );
  memberA = members.rows[0]!.id;

  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
  items = new DrizzleReviewItemRepository(db);
});

afterAll(async () => {
  await pg?.close();
});

/** Convenience: a well-formed create input for one tuple. */
function input(overrides: Partial<Parameters<DrizzleReviewItemRepository["create"]>[1]> = {}) {
  return {
    artifactType: "roadmap_draft" as const,
    artifactId: "roadmap-x",
    artifactVersion: "1",
    artifactDigest: D1,
    riskClassification: "high" as const,
    requiredReviewerRole: "staff" as const,
    ...overrides,
  };
}

describe("snapshot chain (the PR #88 lesson)", () => {
  it("0010_snapshot.json chains prevId to 0009's id and the journal carries the 0010 entry", () => {
    const s9 = JSON.parse(readFileSync(join(migrationsDir, "meta", "0009_snapshot.json"), "utf8")) as {
      id: string;
    };
    const s10 = JSON.parse(readFileSync(join(migrationsDir, "meta", "0010_snapshot.json"), "utf8")) as {
      id: string;
      prevId: string;
    };
    expect(s10.prevId).toBe(s9.id);
    expect(s10.id).not.toBe(s9.id);
    const journal = JSON.parse(readFileSync(join(migrationsDir, "meta", "_journal.json"), "utf8")) as {
      entries: { idx: number; tag: string }[];
    };
    expect(journal.entries.at(-1)).toMatchObject({ idx: 10, tag: "0010_review_scoping" });
  });
});

describe("org-scoped open-review 5-tuple uniqueness (founder decision #3, verbatim)", () => {
  it("rejects a second OPEN item for the SAME org-scoped 5-tuple", async () => {
    await items.create(ORG_A, input(), NOW);
    await expect(items.create(ORG_A, input(), NOW)).rejects.toBeInstanceOf(OpenReviewItemExistsError);
  });

  it("allows the same tuple OPEN in a DIFFERENT org (uniqueness is organization-scoped)", async () => {
    const b = await items.create(ORG_B, input(), NOW);
    expect(b.organizationId).toBe(ORG_B);
    expect(b.artifactVersion).toBe("1");
  });

  it("allows a NEW artifact version while the old version's item is still open (the tuple differs)", async () => {
    const v2 = await items.create(ORG_A, input({ artifactVersion: "2", artifactDigest: D2 }), NOW);
    expect(v2.artifactVersion).toBe("2");
    // ...and the same version under a DIFFERENT workflow also differs.
    const otherWorkflow = await items.create(ORG_A, input({ workflowType: "client_communication" }), NOW);
    expect(otherWorkflow.workflowType).toBe("client_communication");
  });

  it("a TERMINAL (rejected) item does not prevent a new review of the same tuple", async () => {
    const first = await items.create(ORG_A, input({ artifactId: "roadmap-terminal" }), NOW);
    await items.saveTransition(ORG_A, first.id, "awaiting_review", NOW);
    await items.saveTransition(ORG_A, first.id, "rejected", LATER, {
      reviewedByMemberId: memberA,
      latestDecision: "rejected",
      latestDecisionReasonCode: "RVD_INACCURATE_FACTS",
    });
    const successor = await items.create(
      ORG_A,
      input({ artifactId: "roadmap-terminal", previousReviewItemId: first.id }),
      LATER,
    );
    expect(successor.previousReviewItemId).toBe(first.id);
  });

  it("workflowType defaults to artifactType at the call-site level (never silently in SQL)", async () => {
    const created = await items.create(ORG_A, input({ artifactId: "wf-default" }), NOW);
    expect(created.workflowType).toBe("roadmap_draft");
  });

  it("REQUIRES a non-empty trimmed version and a 64-char lowercase-hex digest — typed error, no row", async () => {
    await expect(
      items.create(ORG_A, input({ artifactId: "bad-ver", artifactVersion: "  " }), NOW),
    ).rejects.toBeInstanceOf(InvalidReviewArtifactRefError);
    for (const digest of ["", "abc", "Z".repeat(64), "A".repeat(64), `${"a".repeat(63)}g`]) {
      await expect(
        items.create(ORG_A, input({ artifactId: "bad-digest", artifactDigest: digest }), NOW),
        digest,
      ).rejects.toBeInstanceOf(InvalidReviewArtifactRefError);
    }
    const listed = await items.listByOrg(ORG_A);
    expect(listed.map((i) => i.artifactId)).not.toContain("bad-ver");
    expect(listed.map((i) => i.artifactId)).not.toContain("bad-digest");
  });
});

describe("stale-artifact publication invariant (founder invariant, verbatim chain)", () => {
  let approvedId = "";

  it("create → submit → approve with digest D1; publish with digest D2 → StaleReviewItemError, state stays approved", async () => {
    const created = await items.create(
      ORG_A,
      input({ artifactId: "stale-poc", artifactVersion: "1", artifactDigest: D1, state: "awaiting_review" }),
      NOW,
    );
    approvedId = created.id;
    await items.recordDecisionAndTransition(
      ORG_A,
      {
        reviewItemId: approvedId,
        decision: "approved_unchanged",
        reasonCode: "RVD_ACCURATE",
        ruleVersion: "review_center.v1.0.0",
        decidedByMemberId: memberA,
        workflowType: "roadmap_draft",
        toState: "approved",
      },
      NOW,
    );
    // The artifact changed after approval (digest D2) — publication is denied.
    await expect(
      items.saveTransition(ORG_A, approvedId, "published", LATER, {
        currentArtifactVersion: "1",
        currentArtifactDigest: D2,
      }),
    ).rejects.toBeInstanceOf(StaleReviewItemError);
    // A changed VERSION is equally stale, and omitting the check fails closed.
    await expect(
      items.saveTransition(ORG_A, approvedId, "published", LATER, {
        currentArtifactVersion: "2",
        currentArtifactDigest: D1,
      }),
    ).rejects.toBeInstanceOf(StaleReviewItemError);
    await expect(items.saveTransition(ORG_A, approvedId, "published", LATER)).rejects.toBeInstanceOf(
      StaleReviewItemError,
    );
    const after = await items.getById(ORG_A, approvedId);
    expect(after!.state).toBe("approved"); // NOT published
    expect(after!.publishedAt).toBeNull();
  });

  it("the correct path: supersede + a fresh ReviewItem for the new version → publishable", async () => {
    // A fresh item reviews the CHANGED artifact (version 2, digest D2)...
    const successor = await items.create(
      ORG_A,
      input({
        artifactId: "stale-poc",
        artifactVersion: "2",
        artifactDigest: D2,
        state: "awaiting_review",
        previousReviewItemId: approvedId,
      }),
      LATER,
    );
    // ...the stale approval is superseded by it...
    const superseded = await items.saveTransition(ORG_A, approvedId, "superseded", LATER, {
      supersededByReviewItemId: successor.id,
    });
    expect(superseded.state).toBe("superseded");
    expect(superseded.supersededByReviewItemId).toBe(successor.id);
    // ...and the NEW review, once approved, publishes against matching facts.
    await items.recordDecisionAndTransition(
      ORG_A,
      {
        reviewItemId: successor.id,
        decision: "approved_unchanged",
        reasonCode: "RVD_ACCURATE",
        ruleVersion: "review_center.v1.0.0",
        decidedByMemberId: memberA,
        workflowType: "roadmap_draft",
        toState: "approved",
      },
      LATER,
    );
    const published = await items.saveTransition(ORG_A, successor.id, "published", LATER, {
      currentArtifactVersion: "2",
      currentArtifactDigest: D2,
    });
    expect(published.state).toBe("published");
    expect(published.publishedAt).toBe(LATER.toISOString());
  });
});
