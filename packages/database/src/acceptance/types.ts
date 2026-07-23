/**
 * Preview acceptance suite (ADR-0050) — shared result types.
 *
 * The suite is the runnable gate the founder set in front of Neon `main`:
 * a FRESH database must be provably exactly what the committed migrations
 * say it should be. Every check is a pure function over a minimal database
 * handle and returns a structured, aggregatable result — executable against
 * PGlite today (CI) and against Neon PREVIEW later via env parameterization.
 */

/**
 * One acceptance check outcome. `detail` always says what was verified, why it
 * failed, or why it was skipped. A `skipped` check is NOT a failure — it never
 * ran (e.g. the write-touching fail-closed smoke against a remote target, which
 * is read-only by default).
 */
export interface CheckResult {
  /** Stable check id (e.g. "rls.tenant_tables_enforced"). */
  check: string;
  passed: boolean;
  detail: string;
  /** True when the check was deliberately not run (does not fail the suite). */
  skipped?: boolean;
}

/** The aggregate report `runAcceptance` returns. */
export interface AcceptanceReport {
  /** What the suite ran against. */
  target: "pglite" | "remote";
  /** True when NO check failed (skipped checks do not fail the suite). */
  passed: boolean;
  results: CheckResult[];
  startedAt: string;
  finishedAt: string;
}

export interface AcceptanceOptions {
  /** Override the migrations directory (defaults to this package's ./migrations). */
  migrationsDir?: string;
  /** Reported target label (default "pglite"). */
  target?: "pglite" | "remote";
  /**
   * Run the fail-closed DML smoke (M2). Defaults to TRUE. The CLI sets it false
   * for remote targets unless ACCEPTANCE_RUN_SMOKE=true, so remote validate-only
   * stays read-only; local PGlite always runs it.
   */
  runSmoke?: boolean;
}
