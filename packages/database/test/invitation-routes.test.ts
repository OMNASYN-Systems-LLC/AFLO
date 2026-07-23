import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomUUID } from "node:crypto";

import { PGlite } from "@electric-sql/pglite";
import { drizzle, type PgliteDatabase } from "drizzle-orm/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { permissionsForRole, type Role, type SessionContext, type SessionContextProvider } from "@aflo/auth";
import { generateInvitationToken, hashInvitationToken } from "@aflo/auth/invitation-token";

import { acceptInvitationByToken } from "../src/services/accept-invitation";
import {
  handleAcceptInvitation,
  handleIssueInvitation,
  type AcceptInvitationRouteDeps,
  type IssueInvitationRouteDeps,
} from "../src/services/invitation-routes";
import { DrizzleInvitationRepository } from "../src/repositories/invitation";

/**
 * Workstream B6/B7 (ADR-0042) — the invitation issuance + acceptance route
 * services, proven credential-free: stub session providers + the real Drizzle
 * repository / accept-by-token core on in-memory Postgres (PGlite). The
 * contracts under test: owner-only issuance through the engine, raw-token-once
 * with digest-only persistence (row dumped), kernel denials as stable 400s,
 * session-verified email (never request input), and the oracle-uniform 404 for
 * invalid_token vs email_mismatch.
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
const FUTURE = new Date("2026-07-30T12:00:00.000Z");

/** Deterministic token pair for issuance: proves the digest-only invariant. */
const RAW_TOKEN = "deterministic-raw-token-for-the-issue-test";
const PAIR = { token: RAW_TOKEN, tokenHash: hashInvitationToken(RAW_TOKEN) };

let pg: PGlite;
let db: PgliteDatabase;
let clientA1 = ""; // reserved by issue tests
let clientA2 = ""; // reserved by the accept-flow client invitation
let clientB1 = ""; // a FOREIGN org's client
let ownerMembershipId = "";
const users: Record<string, string> = {};
const tokens: Record<string, string> = {};

function providerOf(ctx: SessionContext | null): SessionContextProvider {
  return { resolve: async () => ctx };
}

function ctxFor(opts: {
  afloUserId: string;
  role: Role;
  organizationId?: string | null;
  membershipId?: string | null;
  linkedClientId?: string | null;
}): SessionContext {
  return {
    sessionId: "sess-test",
    clerkUserId: `ck_${opts.afloUserId}`,
    afloUserId: opts.afloUserId,
    role: opts.role,
    permissions: permissionsForRole(opts.role),
    accountStatus: "active",
    activeOrganizationId: opts.organizationId ?? null,
    activeMembershipId: opts.membershipId ?? null,
    membershipStatus: opts.role === "platform_admin" ? "none" : "active",
    linkedClientId: opts.linkedClientId ?? null,
    assignedClientIds: null,
  };
}

/** The accept service reads ONLY `afloUserId` from the session (email is the injected accessor). */
function accepterCtx(afloUserId: string): SessionContext {
  return ctxFor({ afloUserId, role: "client", organizationId: ORG_A, linkedClientId: null });
}

function issueDeps(ctx: SessionContext | null, pair = PAIR): IssueInvitationRouteDeps {
  return {
    sessionProvider: providerOf(ctx),
    invitations: new DrizzleInvitationRepository(db),
    now: () => NOW,
    newId: randomUUID,
    generateToken: () => pair,
  };
}

function acceptDeps(ctx: SessionContext | null, verifiedEmail: string | null): AcceptInvitationRouteDeps {
  return {
    sessionProvider: providerOf(ctx),
    acceptInvitation: (input) => acceptInvitationByToken(db, db, input),
    verifiedEmail: async () => verifiedEmail,
    now: () => NOW,
    newMembershipId: randomUUID,
  };
}

/** Raw-SQL assertions bypass RLS deliberately (the repos run as `app_user`). */
async function asSuperuser<T>(fn: () => Promise<T>): Promise<T> {
  await pg.exec("RESET ROLE");
  try {
    return await fn();
  } finally {
    await pg.exec("SET ROLE app_user");
  }
}

async function invitationCountFor(email: string): Promise<number> {
  const r = await asSuperuser(() =>
    pg.query<{ n: number }>(`SELECT count(*)::int AS n FROM invitations WHERE email = $1`, [email]),
  );
  return r.rows[0]!.n;
}

/** Insert a pending ORG_A invitation with a fresh token; remember the RAW token. */
async function seedInvitation(
  key: string,
  opts: { email: string; role: string; clientId?: string | null },
): Promise<void> {
  const { token, tokenHash } = generateInvitationToken();
  tokens[key] = token;
  await pg.query(
    `INSERT INTO invitations (organization_id, email, invitation_type, intended_role, intended_client_id, token_digest, expires_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [ORG_A, opts.email, opts.role === "client" ? "client" : "staff", opts.role, opts.clientId ?? null, tokenHash, FUTURE.toISOString()],
  );
}

beforeAll(async () => {
  pg = await PGlite.create();
  await pg.exec(allMigrations());
  await pg.exec(`
    INSERT INTO organizations (id, name, slug) VALUES
      ('${ORG_A}','Org A','org-a'), ('${ORG_B}','Org B','org-b');
  `);
  const ca = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES
       ($1,'stage-new','Al','A'), ($1,'stage-new','Ada','A') RETURNING id`,
    [ORG_A],
  );
  clientA1 = ca.rows[0]!.id;
  clientA2 = ca.rows[1]!.id;
  const cb = await pg.query<{ id: string }>(
    `INSERT INTO clients (organization_id, pipeline_stage_id, first_name, last_name) VALUES ($1,'stage-new','Bo','B') RETURNING id`,
    [ORG_B],
  );
  clientB1 = cb.rows[0]!.id;

  for (const key of ["owner", "clientUser", "staffAccept", "clientAccept", "wrong", "double", "noEmail"]) {
    const r = await pg.query<{ id: string }>(
      `INSERT INTO users (email, display_name) VALUES ($1,$2) RETURNING id`,
      [`${key}@u.co`, key],
    );
    users[key] = r.rows[0]!.id;
  }
  const om = await pg.query<{ id: string }>(
    `INSERT INTO organization_members (organization_id, user_id, role) VALUES ($1,$2,'organization_owner') RETURNING id`,
    [ORG_A, users.owner],
  );
  ownerMembershipId = om.rows[0]!.id;

  await seedInvitation("staffAccept", { email: "staff-a@x.co", role: "staff_advisor" });
  await seedInvitation("clientAccept", { email: "client-a@x.co", role: "client", clientId: clientA2 });
  await seedInvitation("mismatch", { email: "mism@x.co", role: "staff_advisor" });
  await seedInvitation("double", { email: "double@x.co", role: "staff_advisor" });
  await seedInvitation("noEmail", { email: "no-email@x.co", role: "staff_advisor" });

  // Run the repositories as a NON-superuser role so RLS is actually enforced
  // (a superuser would bypass it and the tenant-isolation paths would be
  // untestable) — the proven pattern from invitation-repository.test.ts.
  await pg.exec(`
    CREATE ROLE app_user NOLOGIN;
    GRANT USAGE ON SCHEMA public TO app_user;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO app_user;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO app_user;
    -- app_user stands in for BOTH role-scoped connections here (tenant AND
    -- resolver), so it needs the resolver's execute grant on the SECURITY
    -- DEFINER token lookup (migration 0007 revoked it from PUBLIC).
    GRANT EXECUTE ON FUNCTION find_invitation_by_token(varchar) TO app_user;
    SET ROLE app_user;
  `);
  db = drizzle(pg);
});

afterAll(async () => {
  await pg?.close();
});

const ownerCtx = () =>
  ctxFor({
    afloUserId: users.owner!,
    role: "organization_owner",
    organizationId: ORG_A,
    membershipId: ownerMembershipId,
  });

describe("handleIssueInvitation — authorization (owner-only, engine-decided)", () => {
  it("401 unauthenticated when no session resolves; nothing persisted", async () => {
    const result = await handleIssueInvitation(issueDeps(null), {
      email: "unauth@x.co",
      intendedRole: "client",
      reservedClientId: clientA1,
    });
    expect(result).toEqual({ status: 401, body: { ok: false, error: "unauthenticated" } });
    expect(await invitationCountFor("unauth@x.co")).toBe(0);
  });

  it("403 permission_denied for a client-role principal", async () => {
    const ctx = ctxFor({ afloUserId: users.clientUser!, role: "client", organizationId: ORG_A, linkedClientId: clientA1 });
    const result = await handleIssueInvitation(issueDeps(ctx), {
      email: "client-tries@x.co",
      intendedRole: "client",
      reservedClientId: clientA1,
    });
    expect(result).toEqual({ status: 403, body: { ok: false, error: "permission_denied" } });
    expect(await invitationCountFor("client-tries@x.co")).toBe(0);
  });

  it("403 permission_denied for organization_admin (matrix footnote b: owner-only)", async () => {
    const ctx = ctxFor({ afloUserId: users.owner!, role: "organization_admin", organizationId: ORG_A, membershipId: ownerMembershipId });
    const result = await handleIssueInvitation(issueDeps(ctx), {
      email: "admin-tries@x.co",
      intendedRole: "staff_advisor",
    });
    expect(result).toEqual({ status: 403, body: { ok: false, error: "permission_denied" } });
  });

  it("403 permission_denied for staff_advisor (engine-denied — issuance is owner-only)", async () => {
    const ctx = ctxFor({ afloUserId: users.owner!, role: "staff_advisor", organizationId: ORG_A, membershipId: ownerMembershipId });
    const result = await handleIssueInvitation(issueDeps(ctx), {
      email: "staff-tries@x.co",
      intendedRole: "client",
      reservedClientId: clientA1,
    });
    expect(result).toEqual({ status: 403, body: { ok: false, error: "permission_denied" } });
    expect(await invitationCountFor("staff-tries@x.co")).toBe(0);
  });

  it("403 no_active_membership for platform_admin (no tenant context — platform surface only)", async () => {
    const ctx = ctxFor({ afloUserId: users.owner!, role: "platform_admin", organizationId: null });
    const result = await handleIssueInvitation(issueDeps(ctx), {
      email: "pa-tries@x.co",
      intendedRole: "staff_advisor",
    });
    expect(result).toEqual({ status: 403, body: { ok: false, error: "no_active_membership" } });
  });
});

describe("handleIssueInvitation — issuance (raw token once, digest persisted)", () => {
  it("owner issues a client invitation → 201 with the RAW token; the row stores ONLY the digest", async () => {
    const result = await handleIssueInvitation(issueDeps(ownerCtx()), {
      email: "Invitee.One@Example.com",
      intendedRole: "client",
      reservedClientId: clientA1,
    });
    expect(result.status).toBe(201);
    if (result.status !== 201) return;
    expect(result.body.ok).toBe(true);
    expect(result.body.token).toBe(RAW_TOKEN); // the ONE appearance of the raw token
    expect(result.body.expiresAt).toBe("2026-07-30T12:00:00.000Z"); // NOW + 7d default TTL

    // Dump the whole row: the digest is stored; the raw token appears NOWHERE.
    const dump = await asSuperuser(() =>
      pg.query<Record<string, unknown>>(`SELECT * FROM invitations WHERE id = $1`, [result.body.invitationId]),
    );
    const row = dump.rows[0]!;
    expect(row.token_digest).toBe(hashInvitationToken(RAW_TOKEN));
    expect(JSON.stringify(row)).not.toContain(RAW_TOKEN);
    expect(row.status).toBe("pending");
    expect(row.email).toBe("invitee.one@example.com"); // kernel-normalized
    expect(row.invitation_type).toBe("client");
    expect(row.intended_client_id).toBe(clientA1);
    expect(row.organization_id).toBe(ORG_A); // the SESSION org, never request input
    expect(row.created_by_member_id).toBe(ownerMembershipId);
  });

  it("409 duplicate_pending_invitation for a second pending invitation to the same email", async () => {
    const result = await handleIssueInvitation(issueDeps(ownerCtx(), generateInvitationToken()), {
      email: "invitee.one@example.com",
      intendedRole: "client",
      reservedClientId: clientA2,
    });
    expect(result).toEqual({ status: 409, body: { ok: false, error: "duplicate_pending_invitation" } });
  });
});

describe("handleIssueInvitation — kernel + input denials (stable 400s)", () => {
  it("400 invalid_client_invitation: a client invitation MUST reserve a client", async () => {
    const result = await handleIssueInvitation(issueDeps(ownerCtx()), {
      email: "no-reservation@x.co",
      intendedRole: "client",
    });
    expect(result).toEqual({ status: 400, body: { ok: false, error: "invalid_client_invitation" } });
    expect(await invitationCountFor("no-reservation@x.co")).toBe(0);
  });

  it("400 invalid_client_invitation: a staff invitation MUST NOT reserve a client", async () => {
    const result = await handleIssueInvitation(issueDeps(ownerCtx()), {
      email: "staff-with-client@x.co",
      intendedRole: "staff_advisor",
      reservedClientId: clientA1,
    });
    expect(result).toEqual({ status: 400, body: { ok: false, error: "invalid_client_invitation" } });
  });

  it("400 role_not_invitable: platform_admin can never be minted by invitation", async () => {
    const result = await handleIssueInvitation(issueDeps(ownerCtx()), {
      email: "pa-invite@x.co",
      intendedRole: "platform_admin",
    });
    expect(result).toEqual({ status: 400, body: { ok: false, error: "role_not_invitable" } });
  });

  it("400 invalid_role / invalid_email for malformed input", async () => {
    expect(
      await handleIssueInvitation(issueDeps(ownerCtx()), { email: "x@x.co", intendedRole: "superuser" }),
    ).toEqual({ status: 400, body: { ok: false, error: "invalid_role" } });
    expect(
      await handleIssueInvitation(issueDeps(ownerCtx()), { email: "not-an-email", intendedRole: "client" }),
    ).toEqual({ status: 400, body: { ok: false, error: "invalid_email" } });
  });

  it("400 client_not_in_organization when reserving a FOREIGN org's client (RLS-invisible)", async () => {
    const result = await handleIssueInvitation(issueDeps(ownerCtx(), generateInvitationToken()), {
      email: "foreign-client@x.co",
      intendedRole: "client",
      reservedClientId: clientB1,
    });
    expect(result).toEqual({ status: 400, body: { ok: false, error: "client_not_in_organization" } });
    expect(await invitationCountFor("foreign-client@x.co")).toBe(0);
  });
});

describe("handleAcceptInvitation — session gates", () => {
  it("401 unauthenticated when no session resolves (sign in with Clerk first)", async () => {
    const result = await handleAcceptInvitation(acceptDeps(null, "staff-a@x.co"), { token: tokens.staffAccept });
    expect(result).toEqual({ status: 401, body: { ok: false, error: "unauthenticated" } });
  });

  it("400 missing_token for a malformed request (reveals nothing)", async () => {
    const result = await handleAcceptInvitation(acceptDeps(accepterCtx(users.staffAccept!), "staff-a@x.co"), {});
    expect(result).toEqual({ status: 400, body: { ok: false, error: "missing_token" } });
  });

  it("401 no_verified_email when the session yields no verified email; invitation untouched", async () => {
    const result = await handleAcceptInvitation(acceptDeps(accepterCtx(users.noEmail!), null), {
      token: tokens.noEmail,
    });
    expect(result).toEqual({ status: 401, body: { ok: false, error: "no_verified_email" } });
    const inv = await asSuperuser(() =>
      pg.query<{ status: string }>(`SELECT status FROM invitations WHERE email = 'no-email@x.co'`),
    );
    expect(inv.rows[0]!.status).toBe("pending");
  });
});

describe("handleAcceptInvitation — acceptance (PGlite end to end)", () => {
  it("valid staff token + session-verified email → 200 membership in the invitation's org", async () => {
    const result = await handleAcceptInvitation(acceptDeps(accepterCtx(users.staffAccept!), "staff-a@x.co"), {
      token: tokens.staffAccept,
    });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, kind: "membership", organizationId: ORG_A },
    });
    const member = await asSuperuser(() =>
      pg.query<{ role: string }>(
        `SELECT role FROM organization_members WHERE organization_id = $1 AND user_id = $2`,
        [ORG_A, users.staffAccept],
      ),
    );
    expect(member.rows[0]!.role).toBe("staff");
  });

  it("valid client token → 200 client_link binding the RESERVED client", async () => {
    const result = await handleAcceptInvitation(acceptDeps(accepterCtx(users.clientAccept!), "client-a@x.co"), {
      token: tokens.clientAccept,
    });
    expect(result).toEqual({
      status: 200,
      body: { ok: true, kind: "client_link", organizationId: ORG_A },
    });
    const link = await asSuperuser(() =>
      pg.query<{ user_id: string; status: string }>(
        `SELECT user_id, status FROM client_user_links WHERE organization_id = $1 AND client_id = $2`,
        [ORG_A, clientA2],
      ),
    );
    expect(link.rows[0]!.user_id).toBe(users.clientAccept);
    expect(link.rows[0]!.status).toBe("active");
  });

  it("double-accept → stable 409 already_accepted", async () => {
    const first = await handleAcceptInvitation(acceptDeps(accepterCtx(users.double!), "double@x.co"), {
      token: tokens.double,
    });
    expect(first.status).toBe(200);
    const second = await handleAcceptInvitation(acceptDeps(accepterCtx(users.double!), "double@x.co"), {
      token: tokens.double,
    });
    expect(second).toEqual({ status: 409, body: { ok: false, error: "already_accepted" } });
  });
});

describe("handleAcceptInvitation — the anti-oracle rule", () => {
  it("invalid token and email mismatch are BYTE-IDENTICAL 404s; the invitation stays pending", async () => {
    const invalid = await handleAcceptInvitation(acceptDeps(accepterCtx(users.wrong!), "wrong@u.co"), {
      token: generateInvitationToken().token, // never seeded
    });
    const mismatch = await handleAcceptInvitation(acceptDeps(accepterCtx(users.wrong!), "wrong@u.co"), {
      token: tokens.mismatch, // real token, but the session's verified email differs
    });
    expect(invalid).toEqual({ status: 404, body: { ok: false, error: "invitation_not_found" } });
    expect(mismatch).toEqual(invalid); // indistinguishable externally
    const inv = await asSuperuser(() =>
      pg.query<{ status: string }>(`SELECT status FROM invitations WHERE email = 'mism@x.co'`),
    );
    expect(inv.rows[0]!.status).toBe("pending"); // a wrong-email probe burns nothing
  });
});
