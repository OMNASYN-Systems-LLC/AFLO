import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { generateInvitationToken } from "@aflo/auth/invitation-token";

import { acceptInvitationByToken } from "../src/services/accept-invitation";

/**
 * End-to-end proof (in-memory Postgres) of the accept-by-token orchestration:
 * resolve the invitation across orgs with NO org context (find_invitation_by_token),
 * verify the raw token, run the kernel, then in one withOrgContext transaction
 * claim the invitation + create the client link / membership. Plus the rejection
 * paths. Credential-free (PGlite).
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
const NOW = new Date("2026-07-20T12:00:00.000Z");
const FUTURE = new Date("2026-07-27T12:00:00.000Z");
const PAST = new Date("2026-07-13T12:00:00.000Z");

let pg: PGlite;
let db: PgliteDatabase;
let clientA = "";
const users: Record<string, string> = {};
const tokens: Record<string, string> = {};

/** Insert a pending invitation with a fresh token; return the RAW token. */
async function seedInvitation(
  key: string,
  opts: { email: string; role: string; clientId?: string | null; expiresAt?: Date },
): Promise<void> {
  const { token, tokenHash } = generateInvitationToken();
  tokens[key] = token;
  await pg.query(
    `INSERT INTO invitations (organization_id, email, invitation_type, intended_role, intended_client_id, token_digest, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [
      ORG_A,
      opts.email,
      opts.role === "client" ? "client" : "staff",
      opts.role,
      opts.clientId ?? null,
      tokenHash,
      (opts.expiresAt ?? FUTURE).toISOString(),
    ],
  );
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${ORG_A}','Org A','org-a');`);
  const c = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Al','A') RETURNING id`,
    [ORG_A],
  );
  clientA = c.rows[0]!.id;
  for (const key of ["client", "staff", "email", "expired", "other", "member"]) {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
      [`${key}@u.co`, key],
    );
    users[key] = r.rows[0]!.id;
  }
  // `member` is ALREADY a member of ORG_A — accepting a staff invite must fail closed.
  await pg.query(`INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'staff')`, [
    ORG_A,
    users.member,
  ]);
  await seedInvitation("staff", { email: "staff@x.co", role: "staff_advisor" });
  await seedInvitation("client", { email: "client@x.co", role: "client", clientId: clientA });
  await seedInvitation("email", { email: "em@x.co", role: "staff_advisor" });
  await seedInvitation("expired", { email: "exp@x.co", role: "staff_advisor", expiresAt: PAST });
  await seedInvitation("bound", { email: "bound@x.co", role: "staff_advisor" });

  db = drizzle(pg);
});

afterAll(async () => {
  await pg?.close();
});

describe("acceptInvitationByToken — happy paths", () => {
  it("staff invitation → creates a membership and marks the invitation accepted", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: tokens.staff!,
      afloUserId: users.staff!,
      email: "staff@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("membership");
    expect(outcome.organizationId).toBe(ORG_A);

    const member = await pg.query<{ role: string }>(
      `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
      [ORG_A, users.staff],
    );
    expect(member.rows[0]!.role).toBe("staff"); // staff_advisor → member role "staff"
    const inv = await pg.query<{ status: string; accepted_by_user_id: string }>(
      `SELECT status, accepted_by_user_id FROM invitations WHERE email = 'staff@x.co'`,
    );
    expect(inv.rows[0]!.status).toBe("accepted");
    expect(inv.rows[0]!.accepted_by_user_id).toBe(users.staff);
  });

  it("client invitation → creates an active client-user link and marks it accepted", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: tokens.client!,
      afloUserId: users.client!,
      email: "client@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.kind).toBe("client_link");
    if (outcome.kind !== "client_link") return;
    expect(outcome.clientId).toBe(clientA);

    const link = await pg.query<{ user_id: string; status: string }>(
      `SELECT user_id, status FROM client_user_links WHERE organization_id = $1 AND client_id = $2`,
      [ORG_A, clientA],
    );
    expect(link.rows[0]!.user_id).toBe(users.client);
    expect(link.rows[0]!.status).toBe("active");
  });
});

describe("acceptInvitationByToken — rejections (no write)", () => {
  it("rejects an unknown/invalid token", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: generateInvitationToken().token, // never seeded
      afloUserId: users.other!,
      email: "whoever@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects an email mismatch and leaves the invitation pending", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: tokens.email!,
      afloUserId: users.other!,
      email: "wrong@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome).toEqual({ ok: false, reason: "email_mismatch" });
    const inv = await pg.query<{ status: string }>(`SELECT status FROM invitations WHERE email = 'em@x.co'`);
    expect(inv.rows[0]!.status).toBe("pending"); // untouched
  });

  it("rejects an expired invitation", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: tokens.expired!,
      afloUserId: users.other!,
      email: "exp@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome).toEqual({ ok: false, reason: "expired" });
  });

  it("rejects re-accepting an already-accepted invitation", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: tokens.staff!,
      afloUserId: users.staff!,
      email: "staff@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome).toEqual({ ok: false, reason: "already_accepted" });
  });

  it("fails closed (already_bound) when the accepter is already a member; invitation stays pending", async () => {
    const outcome = await acceptInvitationByToken(db, db, {
      rawToken: tokens.bound!,
      afloUserId: users.member!, // already an ORG_A member → uq_org_members_org_user
      email: "bound@x.co",
      now: NOW,
      newMembershipId: randomUUID(),
    });
    expect(outcome).toEqual({ ok: false, reason: "already_bound" });
    // The claim rolled back with the failed insert — the invitation is still pending.
    const inv = await pg.query<{ status: string }>(`SELECT status FROM invitations WHERE email = 'bound@x.co'`);
    expect(inv.rows[0]!.status).toBe("pending");
  });
});
