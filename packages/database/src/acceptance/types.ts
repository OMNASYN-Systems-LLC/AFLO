/**
 * Preview acceptance suite (ADR-0050) — shared result types.
 *
 * The suite is the runnable gate the founder set in front of Neon `main`:
 * a FRESH database must be provably exactly what the committed migrations
 * say it should be. Every check is a pure function over a minimal database
 * handle and returns a structured, aggregatable result — executable against
 * PGlite today (CI) and against Neon PREVIEW later via env parameterization.
 */

/** One acceptance check outcome. `detail` always says what was verified or why it failed. */
export interface CheckResult {
  /** Stable check id (e.g. "rls.tenant_tables_enforced"). */
  check: string;
  passed: boolean;
  detail: string;
}

/** The aggregate report `runAcceptance` returns. */
export interface AcceptanceReport {
  /** What the suite ran against. */
  target: "pglite" | "remote";
  /** True only when EVERY check passed. */
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
}
