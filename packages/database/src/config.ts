/**
 * Database environment validation (Production Readiness, Phase 1).
 *
 * The Neon setup uses two connection strings (charter / founder directive):
 *   - `DATABASE_URL`        — the POOLED connection the app and worker query
 *                             through at runtime (PgBouncer endpoint).
 *   - `DIRECT_DATABASE_URL` — the DIRECT connection migrations run over
 *                             (drizzle-kit migrate; pooled endpoints reject the
 *                             session-level statements migrations need).
 *
 * Nothing here connects to a database — it validates the shape of the
 * environment and FAILS CLOSED with a precise, aggregated error so a
 * misconfigured deploy stops at startup instead of erroring mid-request. The
 * live connection factory (driver + pool) lands with the credential-gated Neon
 * pivot; this is its precondition and is fully testable without credentials.
 */

export interface DatabaseConfig {
  /** Pooled runtime connection string (`DATABASE_URL`). */
  url: string;
  /**
   * Direct connection string for migrations (`DIRECT_DATABASE_URL`); `null`
   * when it was not required and not provided. Runtime callers do not need it;
   * migration tooling requires it (`requireDirectUrl: true`).
   */
  directUrl: string | null;
  host: string;
  database: string;
  /** `sslmode` query param if present (Neon uses `require`); `null` if unspecified. */
  sslMode: string | null;
}

export interface DatabaseConfigOptions {
  /** Require `DIRECT_DATABASE_URL` too (migration tooling); defaults to false. */
  requireDirectUrl?: boolean;
}

type Env = Record<string, string | undefined>;

/** Thrown when the database environment is missing or malformed. Fail-closed. */
export class DatabaseConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`invalid database environment:\n  - ${problems.join("\n  - ")}`);
    this.name = "DatabaseConfigError";
  }
}

interface ParsedUrl {
  host: string;
  database: string;
  sslMode: string | null;
}

/** Validate one Postgres URL, pushing precise problems for `name`; null on any failure. */
function parsePostgresUrl(name: string, value: string | undefined, problems: string[]): ParsedUrl | null {
  if (value === undefined || value.trim() === "") {
    problems.push(`${name} is required but is missing or empty`);
    return null;
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    problems.push(`${name} is not a valid URL`);
    return null;
  }
  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    problems.push(`${name} must use the postgres:// or postgresql:// scheme (got "${parsed.protocol}//")`);
    return null;
  }
  if (!parsed.hostname) {
    problems.push(`${name} is missing a host`);
    return null;
  }
  const database = parsed.pathname.replace(/^\//, "");
  if (!database) {
    problems.push(`${name} is missing a database name (the path after the host)`);
    return null;
  }
  return { host: parsed.hostname, database, sslMode: parsed.searchParams.get("sslmode") };
}

/**
 * Whether a runtime database connection is configured. Non-throwing — the app
 * uses this to choose between the mock store and the Neon-backed store; strict
 * validation happens in `getDatabaseConfig` only when a connection is intended.
 */
export function isDatabaseConfigured(env: Env = process.env): boolean {
  const url = env.DATABASE_URL;
  return typeof url === "string" && url.trim() !== "";
}

/**
 * Validate and parse the database environment. Throws `DatabaseConfigError`
 * (aggregating every problem) when anything is missing or malformed, so a
 * misconfigured deploy fails fast and completely rather than one variable at a
 * time. Never returns a partial config.
 */
export function getDatabaseConfig(env: Env = process.env, opts: DatabaseConfigOptions = {}): DatabaseConfig {
  const problems: string[] = [];
  const runtime = parsePostgresUrl("DATABASE_URL", env.DATABASE_URL, problems);

  const directRaw = env.DIRECT_DATABASE_URL;
  const directProvided = directRaw !== undefined && directRaw.trim() !== "";
  let directUrl: string | null = null;
  if (opts.requireDirectUrl || directProvided) {
    // Validate when required, or when provided (a malformed direct URL is a
    // problem even for a runtime-only caller that happens to set it).
    const direct = parsePostgresUrl("DIRECT_DATABASE_URL", directRaw, problems);
    if (direct) directUrl = directRaw!.trim();
  }

  if (problems.length > 0 || !runtime) {
    throw new DatabaseConfigError(problems.length > 0 ? problems : ["DATABASE_URL is required but is missing or empty"]);
  }

  return {
    url: env.DATABASE_URL!.trim(),
    directUrl,
    host: runtime.host,
    database: runtime.database,
    sslMode: runtime.sslMode,
  };
}
