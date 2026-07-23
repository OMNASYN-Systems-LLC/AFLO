import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { acceptanceDbFromPgPool } from "./db";
import { evaluateRemoteTargetGuard } from "./guard";
import { runAcceptance } from "./runner";
import { defaultMigrationsDir } from "./checks";
import type { AcceptanceReport } from "./types";

/**
 * Acceptance CLI (ADR-0050): `pnpm --filter @aflo/database acceptance`.
 *
 *  - No env            → bootstraps a FRESH PGlite, applies the committed
 *                        migrations via the drizzle migrator, runs every check.
 *  - DATABASE_URL_ACCEPTANCE set
 *                      → the REMOTE path. HARD GUARD first (guard.ts): the
 *                        target must be affirmatively non-main, and
 *                        ACCEPTANCE_CONFIRM_NON_MAIN must echo the exact host —
 *                        otherwise exit(1) WITHOUT connecting. VALIDATE-ONLY by
 *                        default; DDL (applying migrations) additionally
 *                        requires ACCEPTANCE_APPLY_MIGRATIONS=true.
 *
 * Exit code 0 only when every check passed.
 */

function printReport(report: AcceptanceReport): void {
  console.log(`\nΛFLO preview acceptance suite — target: ${report.target}`);
  for (const result of report.results) {
    const flag = result.passed ? "PASS" : "FAIL";
    console.log(`  [${flag}] ${result.check} — ${result.detail}`);
  }
  const passed = report.results.filter((r) => r.passed).length;
  console.log(`\n${passed}/${report.results.length} checks passed — ${report.passed ? "ACCEPTED" : "REJECTED"}\n`);
}

async function runLocal(): Promise<AcceptanceReport> {
  // Deferred import: PGlite is a devDependency and must stay out of any
  // production import graph; the CLI only loads it on the local path.
  const { bootstrapAcceptancePGlite } = await import("./bootstrap");
  console.log("No DATABASE_URL_ACCEPTANCE set — bootstrapping a fresh PGlite and applying the committed migrations.");
  const target = await bootstrapAcceptancePGlite();
  try {
    return await runAcceptance(target.db, { target: "pglite" });
  } finally {
    await target.close();
  }
}

async function runRemote(url: string): Promise<AcceptanceReport> {
  const verdict = evaluateRemoteTargetGuard(url, process.env);
  if (!verdict.ok) {
    console.error(`\nREFUSED: ${verdict.reason ?? "guard refused the target"}`);
    console.error(
      "This suite never runs against a target that cannot be affirmatively verified as non-main. " +
        "See docs/adr/ADR-0050-preview-acceptance-suite.md.",
    );
    process.exit(1);
  }
  console.log(`Remote target host '${verdict.host ?? ""}' verified non-main and operator-confirmed.`);
  const pool = new Pool({ connectionString: url, max: 1 });
  try {
    if (verdict.applyMigrations) {
      console.log("ACCEPTANCE_APPLY_MIGRATIONS=true — applying committed migrations via the drizzle migrator.");
      await migrate(drizzle(pool), { migrationsFolder: defaultMigrationsDir() });
    } else {
      console.log("Validate-only mode (default): no DDL will be issued against the remote target.");
    }
    return await runAcceptance(acceptanceDbFromPgPool(pool), { target: "remote" });
  } finally {
    await pool.end();
  }
}

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL_ACCEPTANCE;
  const report = url === undefined || url.length === 0 ? await runLocal() : await runRemote(url);
  printReport(report);
  process.exit(report.passed ? 0 : 1);
}

main().catch((err: unknown) => {
  console.error(`acceptance suite crashed: ${(err as Error).message}`);
  process.exit(1);
});
