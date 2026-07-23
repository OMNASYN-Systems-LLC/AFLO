import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { toClientConfig } from "pg-connection-string";
import { evaluateRemoteTargetGuard, type GuardVerdict } from "./guard";
import { acceptanceDbFromPgPool, type AcceptanceDb } from "./db";
import { defaultMigrationsDir } from "./checks";

/**
 * The ONLY exported way to obtain a REMOTE `AcceptanceDb` (ADR-0050, review M1).
 *
 * The guard lives INSIDE this factory, so there is no unguarded pool-construction
 * path on the package surface: `acceptanceDbFromPgPool` is internal (not exported
 * from index.ts) and `bootstrap.ts` builds a PGlite handle, which needs no guard.
 *
 * When the guard passes, the Pool is constructed from the SAME parsed config the
 * guard validated (`toClientConfig(verdict.config)`) — pg connects to exactly the
 * host that was checked, with NO re-parse of the raw URL (which is what let the
 * `?host=` / percent-encoding bypasses reach a different host than was validated).
 *
 * `applyMigrations()` is the ONLY DDL path: the CLI calls it only when the guard
 * reported `applyMigrations` (ACCEPTANCE_APPLY_MIGRATIONS=true). The pool never
 * leaves this module.
 */

export interface RemoteAcceptanceConnection {
  ok: true;
  db: AcceptanceDb;
  verdict: GuardVerdict;
  /** Apply the committed migrations to the remote target (guarded DDL — remote opt-in). */
  applyMigrations(migrationsDir?: string): Promise<void>;
  close(): Promise<void>;
}

export type RemoteConnectResult = RemoteAcceptanceConnection | { ok: false; verdict: GuardVerdict };

export function connectRemoteAcceptanceDb(
  rawUrl: string,
  env: Record<string, string | undefined>,
): RemoteConnectResult {
  const verdict = evaluateRemoteTargetGuard(rawUrl, env);
  if (!verdict.ok || verdict.config === null) {
    return { ok: false, verdict };
  }
  // Build from the validated config, never from rawUrl — no re-parse divergence.
  const pool = new Pool({ ...toClientConfig(verdict.config), max: 1 });
  return {
    ok: true,
    verdict,
    db: acceptanceDbFromPgPool(pool),
    applyMigrations: async (migrationsDir = defaultMigrationsDir()) => {
      await migrate(drizzle(pool), { migrationsFolder: migrationsDir });
    },
    close: () => pool.end(),
  };
}
