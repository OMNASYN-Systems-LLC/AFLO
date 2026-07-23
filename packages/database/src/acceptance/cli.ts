import { connectRemoteAcceptanceDb } from "./remote";
import { runAcceptance } from "./runner";
import type { AcceptanceReport } from "./types";

/**
 * Acceptance CLI (ADR-0050): `pnpm --filter @aflo/database acceptance`.
 *
 *  - No env            → bootstraps a FRESH PGlite, applies the committed
 *                        migrations via the drizzle migrator, runs every check
 *                        (the fail-closed DML smoke INCLUDED).
 *  - DATABASE_URL_ACCEPTANCE set
 *                      → the REMOTE path via `connectRemoteAcceptanceDb`, which
 *                        runs the HARD GUARD (guard.ts) INSIDE the factory: the
 *                        target must be affirmatively non-main (parse-for-connect,
 *                        no host/hostaddr/options params, host echo) — otherwise
 *                        exit(1) WITHOUT connecting. VALIDATE-ONLY and READ-ONLY
 *                        by default; applying migrations requires
 *                        ACCEPTANCE_APPLY_MIGRATIONS=true, and the fail-closed DML
 *                        smoke requires ACCEPTANCE_RUN_SMOKE=true.
 *
 * Exit code 0 only when the report passed (skipped checks do not fail it).
 */

function printReport(report: AcceptanceReport): void {
  console.log(`\nΛFLO preview acceptance suite — target: ${report.target}`);
  for (const result of report.results) {
    const flag = result.skipped ? "SKIP" : result.passed ? "PASS" : "FAIL";
    console.log(`  [${flag}] ${result.check} — ${result.detail}`);
  }
  const passed = report.results.filter((r) => r.passed).length;
  const skipped = report.results.filter((r) => r.skipped).length;
  const failed = report.results.filter((r) => !r.passed && !r.skipped).length;
  console.log(
    `\n${passed} passed, ${failed} failed, ${skipped} skipped of ${report.results.length} — ${report.passed ? "ACCEPTED" : "REJECTED"}\n`,
  );
}

async function runLocal(): Promise<AcceptanceReport> {
  // Deferred import: PGlite is a devDependency and must stay out of any
  // production import graph; the CLI only loads it on the local path.
  const { bootstrapAcceptancePGlite } = await import("./bootstrap");
  console.log("No DATABASE_URL_ACCEPTANCE set — bootstrapping a fresh PGlite and applying the committed migrations.");
  const target = await bootstrapAcceptancePGlite();
  try {
    // Local PGlite ALWAYS runs the fail-closed smoke.
    return await runAcceptance(target.db, { target: "pglite", runSmoke: true });
  } finally {
    await target.close();
  }
}

async function runRemote(url: string): Promise<AcceptanceReport> {
  const connection = connectRemoteAcceptanceDb(url, process.env);
  if (!connection.ok) {
    console.error(`\nREFUSED: ${connection.verdict.reason ?? "guard refused the target"}`);
    console.error(
      "This suite never runs against a target that cannot be affirmatively verified as non-main. " +
        "See docs/adr/ADR-0050-preview-acceptance-suite.md.",
    );
    process.exit(1);
  }
  const { verdict } = connection;
  console.log(`Remote target host '${verdict.host ?? ""}' verified non-main and operator-confirmed.`);
  try {
    if (verdict.applyMigrations) {
      console.log("ACCEPTANCE_APPLY_MIGRATIONS=true — applying committed migrations via the drizzle migrator.");
      await connection.applyMigrations();
    } else {
      console.log("Validate-only mode (default): no DDL will be issued against the remote target.");
    }
    if (verdict.runSmoke) {
      console.log("ACCEPTANCE_RUN_SMOKE=true — the fail-closed DML smoke will run (inside a rolled-back transaction).");
    } else {
      console.log("Read-only mode (default): the fail-closed DML smoke is SKIPPED (set ACCEPTANCE_RUN_SMOKE=true to run it).");
    }
    return await runAcceptance(connection.db, { target: "remote", runSmoke: verdict.runSmoke });
  } finally {
    await connection.close();
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
