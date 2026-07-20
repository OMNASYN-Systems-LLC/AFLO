import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  acceptInvitation,
  issueInvitation,
  revokeInvitation,
  type Invitation,
  type Role,
} from "@aflo/auth";
import { generateInvitationToken } from "@aflo/auth/invitation-token";

import {
  ClientAlreadyLinkedError,
  ClientLinkNotFoundError,
  DrizzleClientUserLinkRepository,
  DrizzleInvitationRepository,
  InvitationNotFoundError,
} from "../src/repositories/invitation";

/**
 * Integration proof (in-memory Postgres, non-superuser role) that the Drizzle
 * org-scoped identity repositories:
 *  - persist/read invitations through withOrgContext (RLS-scoped to one org),
 *  - store the token as a DIGEST only (never the raw token),
 *  - persist kernel transitions (accept / revoke),
 *  - enforce the one-active-link-each-way invariant via the partial-unique
 *    indexes (surfaced as ClientAlreadyLinkedError), and revoke/re-link.
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
const NOW = new Date("2026-07-20T12:00:00.000Z");
const EXPIRES = new Date("2026-07-27T12:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let invRepo: DrizzleInvitationRepository;
let linkRepo: DrizzleClientUserLinkRepository;
let clientA1 = "";
let clientA2 = "";
let userA1 = "";
let userA2 = "";

/**
 * Build a pending invitation with a fresh token (returns the raw token too).
 * `email` is distinct per call in the tests — the partial-unique `(org, email)
 * WHERE pending` index rejects two pending invitations for the same address.
 */
function buildInvitation(
  organizationId: string,
  role: Role,
  reservedClientId: string | null,
  email = "Invitee@Example.com",
): { invitation: Invitation; rawToken: string } {
  const { token, tokenHash } = generateInvitationToken();
  const invitation = issueInvitation({
    id: randomUUID(),
    organizationId,
    email,
    intendedRole: role,
    reservedClientId,
    tokenHash,
    createdAtIso: NOW.toISOString(),
    expiresAtIso: EXPIRES.toISOString(),
  });
  return { invitation, rawToken: token };
}

async function asSuperuser<T>(fn: () => Promise<T>): Promise<T> {
  await pg.exec("RESET ROLE");
  try {
    return await fn();
  } finally {
    await pg.exec("SET ROLE app_user");
  }
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}', 'Org A', 'org-a'), ('${ORG_B}', 'Org B', 'org-b');
  `);
  const rows = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES
       ($1,'stage-new','Al','A'), ($1,'stage-new','Ada','A') RETURNING id`,
    [ORG_A],
  );
  clientA1 = rows.rows[0]!.id;
  clientA2 = rows.rows[1]!.id;
  const users = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('u1@x.co','U1'), ('u2@x.co','U2') RETURNING id`,
  );
  userA1 = users.rows[0]!.id;
  userA2 = users.rows[1]!.id;

  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
  invRepo = new DrizzleInvitationRepository(db);
  linkRepo = new DrizzleClientUserLinkRepository(db);
});

afterAll(async () => {
  await pg?.close();
});

describe("DrizzleInvitationRepository — org-scoped, digest-only", () => {
  let staffInvId = "";
  let staffRawToken = "";
  let staffTokenHash = "";

  it("issues a staff invitation and reads it back (client reservation null)", async () => {
    const { invitation, rawToken } = buildInvitation(ORG_A, "staff_advisor", null);
    staffRawToken = rawToken;
    staffTokenHash = invitation.tokenHash;
    const saved = await invRepo.issue(ORG_A, invitation, null, NOW);
    staffInvId = saved.id;
    expect(saved.status).toBe("pending");
    expect(saved.reservedClientId).toBeNull();
    expect(saved.email).toBe("invitee@example.com"); // normalized by the kernel
    const got = await invRepo.getById(ORG_A, saved.id);
    expect(got?.intendedRole).toBe("staff_advisor");
  });

  it("stores the token as a DIGEST only — never the raw token", async () => {
    const raw = await asSuperuser(() =>
      pg.query<{ token_digest: string }>(`SELECT token_digest FROM invitations WHERE id = $1`, [staffInvId]),
    );
    expect(raw.rows[0]!.token_digest).toBe(staffTokenHash);
    expect(raw.rows[0]!.token_digest).not.toBe(staffRawToken);
    // The raw token appears nowhere in the row.
    const dump = await asSuperuser(() =>
      pg.query<{ row: string }>(`SELECT invitations::text AS row FROM invitations WHERE id = $1`, [staffInvId]),
    );
    expect(dump.rows[0]!.row).not.toContain(staffRawToken);
  });

  it("issues a client invitation reserving a specific client", async () => {
    const { invitation } = buildInvitation(ORG_A, "client", clientA1, "client1@x.co");
    const saved = await invRepo.issue(ORG_A, invitation, null, NOW);
    expect(saved.reservedClientId).toBe(clientA1);
    expect(saved.intendedRole).toBe("client");
  });

  it("isolates by org: org B cannot see org A's invitations", async () => {
    expect(await invRepo.getById(ORG_B, staffInvId)).toBeNull();
    expect(await invRepo.listByOrg(ORG_B)).toEqual([]);
    const aInvites = await invRepo.listByOrg(ORG_A);
    expect(aInvites.length).toBeGreaterThanOrEqual(2);
  });

  it("filters listByOrg by status", async () => {
    const pending = await invRepo.listByOrg(ORG_A, "pending");
    expect(pending.every((i) => i.status === "pending")).toBe(true);
  });

  it("persists a revoke transition (status + revoked_at)", async () => {
    const got = (await invRepo.getById(ORG_A, staffInvId))!;
    const result = revokeInvitation(got);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const saved = await invRepo.save(ORG_A, result.invitation, NOW);
    expect(saved.status).toBe("revoked");
    const raw = await asSuperuser(() =>
      pg.query<{ revoked_at: string | null }>(`SELECT revoked_at FROM invitations WHERE id = $1`, [staffInvId]),
    );
    expect(raw.rows[0]!.revoked_at).not.toBeNull();
  });

  it("persists an accept transition (status + accepted-by/at)", async () => {
    const { invitation } = buildInvitation(ORG_A, "staff_advisor", null, "staff2@x.co");
    const saved = await invRepo.issue(ORG_A, invitation, null, NOW);
    const result = acceptInvitation(saved, {
      afloUserId: userA1,
      email: saved.email,
      nowIso: NOW.toISOString(),
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const persisted = await invRepo.save(ORG_A, result.invitation, NOW);
    expect(persisted.status).toBe("accepted");
    expect(persisted.acceptedByAfloUserId).toBe(userA1);
    expect(persisted.acceptedAtIso).toBe(NOW.toISOString());
  });

  it("save throws for an unknown/foreign invitation id", async () => {
    const ghost: Invitation = {
      id: randomUUID(),
      organizationId: ORG_A,
      email: "x@x.co",
      intendedRole: "staff_advisor",
      reservedClientId: null,
      tokenHash: "d".repeat(64),
      status: "revoked",
      createdAtIso: NOW.toISOString(),
      expiresAtIso: EXPIRES.toISOString(),
      acceptedByAfloUserId: null,
      acceptedAtIso: null,
    };
    await expect(invRepo.save(ORG_A, ghost, NOW)).rejects.toBeInstanceOf(InvitationNotFoundError);
  });
});

describe("DrizzleClientUserLinkRepository — one active link each way", () => {
  it("links a client to a user and reads it back both ways", async () => {
    const link = await linkRepo.link(ORG_A, clientA1, userA1, NOW);
    expect(link.status).toBe("active");
    expect((await linkRepo.getActiveByClient(ORG_A, clientA1))?.userId).toBe(userA1);
    expect((await linkRepo.getActiveByUser(ORG_A, userA1))?.clientId).toBe(clientA1);
  });

  it("rejects a second active link to the same client", async () => {
    await expect(linkRepo.link(ORG_A, clientA1, userA2, NOW)).rejects.toBeInstanceOf(ClientAlreadyLinkedError);
  });

  it("rejects a user claiming a second active client", async () => {
    await expect(linkRepo.link(ORG_A, clientA2, userA1, NOW)).rejects.toBeInstanceOf(ClientAlreadyLinkedError);
  });

  it("revoke frees both sides so a fresh link can be created", async () => {
    const active = (await linkRepo.getActiveByClient(ORG_A, clientA1))!;
    const revoked = await linkRepo.revoke(ORG_A, active.id, NOW);
    expect(revoked.status).toBe("revoked");
    expect(revoked.revokedAtIso).not.toBeNull();
    expect(await linkRepo.getActiveByClient(ORG_A, clientA1)).toBeNull();
    // The client can now be linked to a different user.
    const relink = await linkRepo.link(ORG_A, clientA1, userA2, NOW);
    expect(relink.userId).toBe(userA2);
  });

  it("isolates by org and throws on an unknown link id", async () => {
    expect(await linkRepo.getActiveByClient(ORG_B, clientA1)).toBeNull();
    await expect(linkRepo.revoke(ORG_A, randomUUID(), NOW)).rejects.toBeInstanceOf(ClientLinkNotFoundError);
  });
});
