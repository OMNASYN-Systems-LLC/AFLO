import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAesGcmFieldCipher, generateFieldEncryptionKey } from "@aflo/security";
import { generateInvitationToken } from "@aflo/auth/invitation-token";
import { issueInvitation } from "@aflo/auth";

import { createRepositories, type Repositories } from "../src/repositories/factory";

/**
 * Proof that the DI seam (`createRepositories`) wires every repository to the
 * RIGHT handle: PGlite drizzle handles + an ephemeral cipher are injected
 * through the exact function the production composition root uses, then the
 * full activation loop runs THROUGH THE FACTORY OUTPUT — issue an invitation
 * (org-scoped tenant handle), accept it by token (resolver read → org-scoped
 * write via the pre-bound orchestration), link identity + record a webhook
 * receipt + check a revocation (resolver handle), and round-trip an encrypted
 * message (tenant handle + cipher). Credential-free.
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
const NOW = new Date("2026-07-22T12:00:00.000Z");
const EXPIRES = new Date("2026-07-29T12:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let repos: Repositories;
let clientA = "";
let staffUser = "";

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${ORG_A}','Org A','org-a');`);
  const c = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Al','A') RETURNING id`,
    [ORG_A],
  );
  clientA = c.rows[0]!.id;
  const u = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('staff@x.co','S') RETURNING id`,
  );
  staffUser = u.rows[0]!.id;

  db = drizzle(pg);
  // The exact production seam: two handles + a cipher. In tests both handles
  // are the same PGlite db; in production they are the two role-scoped pools.
  repos = createRepositories({
    tenantDb: db,
    resolverDb: db,
    cipher: createAesGcmFieldCipher(generateFieldEncryptionKey()),
  });
});

afterAll(async () => {
  await pg?.close();
});

describe("createRepositories — the DI seam wires the full loop", () => {
  it("issue → accept-by-token → membership, all through the factory output", async () => {
    const { token, tokenHash } = generateInvitationToken();
    const invitation = issueInvitation({
      id: randomUUID(),
      organizationId: ORG_A,
      email: "invitee@x.co",
      intendedRole: "staff_advisor",
      tokenHash,
      createdAtIso: NOW.toISOString(),
      expiresAtIso: EXPIRES.toISOString(),
    });
    await repos.invitations.issue(ORG_A, invitation, null, NOW);

    const outcome = await repos.acceptInvitation({
      rawToken: token,
      afloUserId: staffUser,
      email: "invitee@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("membership");
    expect(outcome.organizationId).toBe(ORG_A);
  });

  it("resolver repos are wired: identity link, webhook receipt, revocation check", async () => {
    const linked = await repos.identityAccounts.link("clerk", "clerk_777", staffUser, NOW);
    expect(linked.afloUserId).toBe(staffUser);

    const receipt = await repos.webhookEvents.recordReceipt("clerk", "evt_f1", "user.created", "a".repeat(64), NOW);
    expect(receipt.isNew).toBe(true);

    expect(await repos.sessionRevocations.isSessionRevoked(staffUser, NOW, null, NOW)).toBe(false);
  });

  it("messaging is wired with the injected cipher: encrypted round-trip", async () => {
    const thread = await repos.messaging.createThread(ORG_A, { clientId: clientA, subject: "Hello" }, NOW);
    const sent = await repos.messaging.postMessage(
      ORG_A,
      { threadId: thread.id, senderRole: "staff", senderId: staffUser, body: "factory-wired body" },
      NOW,
    );
    expect(sent.body).toBe("factory-wired body");
    const raw = await pg.query<{ hex: string }>(
      `SELECT encode(body_encrypted,'hex') AS hex FROM messages WHERE id = $1`,
      [sent.id],
    );
    expect(raw.rows[0]!.hex).not.toContain(Buffer.from("factory-wired body", "utf8").toString("hex"));
    const listed = await repos.messaging.listMessages(ORG_A, thread.id);
    expect(listed.map((m) => m.body)).toEqual(["factory-wired body"]);
  });
});
