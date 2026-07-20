import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { PGlite } from "@electric-sql/pglite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

/**
 * Runtime proof (in-memory Postgres) that migration 0007's resolver privilege
 * boundary (ADR-0026 / ADR-0030) is REAL, not merely documented:
 *
 *  - the tenant-request role (aflo_app, NON-BYPASSRLS) CANNOT read the three
 *    un-scoped auth tables and CANNOT execute the accept-by-token function;
 *  - the resolver role (aflo_auth_resolver, BYPASSRLS) CAN read them, and its
 *    SECURITY DEFINER function returns an invitation by its token digest WITHOUT
 *    an org context (across orgs) — the accept-by-token path;
 *  - the tenant role can neither resolve the invitation by token (no function
 *    access) nor see it via a direct RLS read pre-org.
 *
 * Ordering mirrors deploy: tables + baseline grants exist, THEN the grant-matrix
 * migration tightens. Credential-free (PGlite).
 */

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "..", "migrations");

function sql(files: string[]): string {
  return files
    .map((f) => readFileSync(join(migrationsDir, f), "utf8"))
    .join("\n")
    .replaceAll("--> statement-breakpoint", "");
}

function migrationFiles(): string[] {
  return readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
}

const ORG_A = "00000000-0000-0000-0000-0000000000aa";
const TOKEN_DIGEST = "a".repeat(64);
const UNSCOPED_TABLES = ["identity_provider_accounts", "provider_webhook_events", "session_revocations"];

let pg: PGlite;
let userId = "";

async function asRole<T>(role: string, fn: () => Promise<T>): Promise<T> {
  await pg.exec(`SET ROLE ${role}`);
  try {
    return await fn();
  } finally {
    await pg.exec("RESET ROLE");
  }
}

beforeAll(async () => {
  pg = await PGlite.create();
  const files = migrationFiles();
  const before0007 = files.filter((f) => f < "0007");
  const only0007 = files.filter((f) => f.startsWith("0007"));

  // 1) schema (0000–0006), as the owner/superuser.
  await pg.exec(sql(before0007));

  // 2) seed the un-scoped tables + an invitation with a known token digest.
  await pg.exec(`INSERT INTO organizations (id, name, slug) VALUES ('${ORG_A}', 'Org A', 'org-a');`);
  const u = await pg.query<{ id: string }>(
    `INSERT INTO users (email, display_name) VALUES ('u@x.co','U') RETURNING id`,
  );
  userId = u.rows[0]!.id;
  await pg.exec(`
    INSERT INTO invitations (organization_id, email, invitation_type, intended_role, token_digest, expires_at)
      VALUES ('${ORG_A}', 'i@x.co', 'staff', 'staff_advisor', '${TOKEN_DIGEST}', now() + interval '7 days');
    INSERT INTO identity_provider_accounts (provider, provider_user_id, aflo_user_id)
      VALUES ('clerk', 'clerk_123', '${userId}');
    INSERT INTO session_revocations (user_id, reason_code) VALUES ('${userId}', 'disabled');
    INSERT INTO provider_webhook_events (provider, provider_event_id, event_type, payload_digest)
      VALUES ('clerk', 'evt_1', 'user.created', '${"b".repeat(64)}');
  `);

  // 3) provision roles + baseline grants (the deploy step), THEN apply 0007 so
  //    its REVOKE tightens last — the realistic ordering.
  await pg.exec(`
    CREATE ROLE aflo_auth_resolver BYPASSRLS NOLOGIN;
    CREATE ROLE aflo_app NOLOGIN;
    GRANT USAGE ON SCHEMA public TO aflo_app, aflo_auth_resolver;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aflo_app;
    GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO aflo_auth_resolver;
    GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO aflo_app, aflo_auth_resolver;
  `);
  await pg.exec(sql(only0007));
});

afterAll(async () => {
  await pg?.close();
});

describe("resolver grant matrix — tenant role is walled off from the un-scoped tables", () => {
  it("aflo_app cannot SELECT any of the three un-scoped tables", async () => {
    await asRole("aflo_app", async () => {
      for (const table of UNSCOPED_TABLES) {
        await expect(pg.query(`SELECT * FROM ${table}`)).rejects.toThrow(/permission denied/i);
      }
    });
  });

  it("aflo_app cannot execute the accept-by-token resolver function", async () => {
    await asRole("aflo_app", async () => {
      await expect(
        pg.query(`SELECT * FROM find_invitation_by_token($1)`, [TOKEN_DIGEST]),
      ).rejects.toThrow(/permission denied/i);
    });
  });

  it("aflo_app cannot resolve the invitation via a direct pre-org read either (RLS)", async () => {
    await asRole("aflo_app", async () => {
      // aflo_app retains the invitations table grant (only the three un-scoped
      // tables were revoked), but with no org context RLS exposes zero rows.
      const rows = (await pg.query(`SELECT id FROM invitations`)).rows;
      expect(rows).toHaveLength(0);
    });
  });
});

describe("resolver grant matrix — the resolver role is the privileged path", () => {
  it("aflo_auth_resolver CAN read the three un-scoped tables", async () => {
    await asRole("aflo_auth_resolver", async () => {
      for (const table of UNSCOPED_TABLES) {
        const rows = (await pg.query(`SELECT * FROM ${table}`)).rows;
        expect(rows.length).toBeGreaterThanOrEqual(1);
      }
    });
  });

  it("the SECURITY DEFINER function returns the invitation by token WITHOUT an org context", async () => {
    await asRole("aflo_auth_resolver", async () => {
      // No app.current_org_id is set — the function bypasses RLS (BYPASSRLS owner).
      const hit = await pg.query<{ organization_id: string; token_digest: string }>(
        `SELECT organization_id, token_digest FROM find_invitation_by_token($1)`,
        [TOKEN_DIGEST],
      );
      expect(hit.rows).toHaveLength(1);
      expect(hit.rows[0]!.organization_id).toBe(ORG_A);
      // An unknown token resolves to nothing.
      const miss = await pg.query(`SELECT * FROM find_invitation_by_token($1)`, ["c".repeat(64)]);
      expect(miss.rows).toHaveLength(0);
    });
  });

  it("the resolver can read a revocation user-scoped (WHERE user_id = …)", async () => {
    await asRole("aflo_auth_resolver", async () => {
      const rows = (
        await pg.query(`SELECT reason_code FROM session_revocations WHERE user_id = $1`, [userId])
      ).rows;
      expect(rows).toHaveLength(1);
    });
  });
});
