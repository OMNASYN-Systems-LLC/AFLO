import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { acceptanceDbFromPGlite, type AcceptanceDb } from "./db";
import { defaultMigrationsDir } from "./checks";

/**
 * Credential-free acceptance target: a FRESH in-memory Postgres (PGlite),
 * provisioned exactly as the cutover runbook (§2) prescribes for a Neon
 * branch — roles + baseline grants BEFORE migrations, so migration 0007's
 * REVOKE wall tightens last — then migrated via the real drizzle migrator so
 * `drizzle.__drizzle_migrations` bookkeeping exists for the journal check,
 * exactly as `db:migrate` produces it on a live branch.
 *
 * Dev-only module: imports the PGlite devDependency. Never import it from the
 * package's public index (the web app must not pull PGlite into its graph).
 */

export interface AcceptancePGlite {
  db: AcceptanceDb;
  pglite: PGlite;
  close(): Promise<void>;
}

export async function bootstrapAcceptancePGlite(migrationsDir = defaultMigrationsDir()): Promise<AcceptancePGlite> {
  const pglite = await PGlite.create();

  // Runbook §2 role provisioning, adapted to a single-session in-memory server:
  // NOLOGIN roles (PGlite has one connection; checks use SET ROLE), tenant
  // baseline via DEFAULT PRIVILEGES so every table the migrations create gets
  // the aflo_app grants — mirroring `ALTER DEFAULT PRIVILEGES` + the pre-0007
  // ordering on a real branch. The resolver role starts with ONLY schema usage;
  // its table privileges come from migrations 0007/0008 (load-bearing).
  await pglite.exec(`
    CREATE ROLE aflo_app NOLOGIN NOBYPASSRLS;
    CREATE ROLE aflo_auth_resolver NOLOGIN BYPASSRLS;
    GRANT USAGE ON SCHEMA public TO aflo_app, aflo_auth_resolver;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO aflo_app;
    ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO aflo_app;
  `);

  // The REAL drizzle migrator (journal-ordered, writes drizzle.__drizzle_migrations).
  await migrate(drizzle(pglite), { migrationsFolder: migrationsDir });

  return {
    db: acceptanceDbFromPGlite(pglite),
    pglite,
    close: () => pglite.close(),
  };
}
