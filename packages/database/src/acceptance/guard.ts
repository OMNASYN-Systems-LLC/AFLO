import { parse as parseConnectionString, type ConnectionOptions } from "pg-connection-string";

/**
 * Remote-target hard guard (ADR-0050 — NON-NEGOTIABLE), rebuilt around the
 * PARSE-FOR-CONNECT principle after two live bypasses of the earlier
 * WHATWG-only guard:
 *
 *   C1 (?host= override): pg parses connection strings with pg-connection-string,
 *      where a `?host=` query param SILENTLY OVERRIDES the authority host. The
 *      old guard validated `new URL(url).hostname` (the decoy) while pg connected
 *      to the `?host=` target.
 *   C2 (percent-encoding): `postgres://` is a non-special scheme, so WHATWG
 *      `URL` keeps the host OPAQUE (percent-escapes NOT decoded) — `ep-m%61in-…`
 *      passed the marker check while pg-connection-string decoded it to
 *      `ep-main-…` and connected there.
 *
 * The fix, one principle: evaluate the guard on the SAME parse pg uses
 * (`pg-connection-string`), validating the DECODED host that will ACTUALLY be
 * connected to. Additionally:
 *   - reject outright any URL carrying `host`, `hostaddr`, or `options` query
 *     params (they redirect or reconfigure the connection);
 *   - reject any URL whose pg-parsed host differs from the WHATWG authority host
 *     (defense in depth — any percent-encoding / host manipulation refuses).
 *
 * The guard then applies the affirmative-target policy:
 *   1. main-like markers (substring) in host or database refuse outright;
 *   2. a verifiable non-main branch discriminator (clean token) is REQUIRED;
 *   3. `ACCEPTANCE_CONFIRM_NON_MAIN` must exactly echo the pg-parsed host;
 *   4. remote DDL requires `ACCEPTANCE_APPLY_MIGRATIONS=true`; the fail-closed
 *      DML smoke requires `ACCEPTANCE_RUN_SMOKE=true` (remote is read-only by
 *      default — see ADR-0050 / runner).
 *
 * NOTE ON THE MARKER LAYER (honesty): random Neon endpoint names (`ep-cool-star-…`)
 * rarely contain a main-like substring, so the marker layer seldom fires on real
 * hosts. The OPERATIVE defenses are the affirmative discriminator + the exact
 * host echo; the marker layer is a cheap catch for obviously-named targets.
 *
 * Pure function — evaluating the guard NEVER opens a connection. The parsed
 * config it returns is what the remote factory hands to pg, so there is no
 * re-parse divergence between validation and connection.
 */

export const MAIN_LIKE_MARKERS = ["main", "prod", "production", "primary", "live"] as const;

export const NON_MAIN_TOKENS = [
  "preview",
  "dev",
  "development",
  "staging",
  "test",
  "branch",
  "acceptance",
  "ephemeral",
  "sandbox",
  "localhost",
  "127",
] as const;

/** Connection query params that redirect or reconfigure where/how pg connects. */
export const FORBIDDEN_CONNECTION_PARAMS = ["host", "hostaddr", "options"] as const;

export interface GuardVerdict {
  ok: boolean;
  /** The pg-parsed host that will ACTUALLY be connected to (null when parsing failed). */
  host: string | null;
  /** Refusal reason (null when ok). */
  reason: string | null;
  /** True only when ACCEPTANCE_APPLY_MIGRATIONS === "true" (remote DDL opt-in). */
  applyMigrations: boolean;
  /** True only when ACCEPTANCE_RUN_SMOKE === "true" (remote DML smoke opt-in). */
  runSmoke: boolean;
  /**
   * The validated pg-connection-string config. The remote factory builds the
   * Pool from THIS (never a re-parse), so pg connects to exactly what was
   * validated. Null on refusal.
   */
  config: ConnectionOptions | null;
}

function refuse(
  host: string | null,
  reason: string,
  flags: { applyMigrations: boolean; runSmoke: boolean },
): GuardVerdict {
  return { ok: false, host, reason, applyMigrations: flags.applyMigrations, runSmoke: flags.runSmoke, config: null };
}

/** Split a host/database name into clean tokens (for the affirmative discriminator). */
function tokens(value: string): string[] {
  return value.split(/[.\-_/]+/).filter((t) => t.length > 0);
}

/** Normalize a host for comparison/marker scanning: lowercase, strip IPv6 brackets. */
function normHost(host: string): string {
  return host.toLowerCase().replace(/^\[/, "").replace(/\]$/, "");
}

/**
 * Evaluate whether `rawUrl` is a permissible NON-MAIN acceptance target.
 * Never connects. See the module doc for the full refusal matrix.
 */
export function evaluateRemoteTargetGuard(rawUrl: string, env: Record<string, string | undefined>): GuardVerdict {
  const flags = {
    applyMigrations: env.ACCEPTANCE_APPLY_MIGRATIONS === "true",
    runSmoke: env.ACCEPTANCE_RUN_SMOKE === "true",
  };

  // WHATWG parse — for the protocol check, the forbidden-param scan, and the
  // authority-host divergence check. It is NOT the source of the connect host.
  let whatwgUrl: URL;
  try {
    whatwgUrl = new URL(rawUrl);
  } catch {
    return refuse(null, "DATABASE_URL_ACCEPTANCE is not a parseable URL", flags);
  }
  if (whatwgUrl.protocol !== "postgres:" && whatwgUrl.protocol !== "postgresql:") {
    return refuse(null, `refusing non-postgres protocol '${whatwgUrl.protocol}'`, flags);
  }

  // Reject connection-redirecting query params OUTRIGHT (host/hostaddr/options).
  for (const param of FORBIDDEN_CONNECTION_PARAMS) {
    if (whatwgUrl.searchParams.has(param)) {
      return refuse(
        null,
        `URL carries a '${param}' query parameter, which redirects or reconfigures the connection — refusing. ` +
          "Provide a plain postgres URL with the target host in the authority.",
        flags,
      );
    }
  }

  // Parse with pg-connection-string — the SAME parse pg uses. This is the host
  // that will ACTUALLY be connected to (percent-decoded, ?host= applied).
  let config: ConnectionOptions;
  try {
    config = parseConnectionString(rawUrl);
  } catch (err) {
    return refuse(null, `pg-connection-string could not parse the URL: ${(err as Error).message}`, flags);
  }
  const pgHostRaw = config.host;
  if (!pgHostRaw || pgHostRaw.length === 0) {
    return refuse(null, "the connection string resolves to no host", flags);
  }
  const pgHost = normHost(pgHostRaw);
  const database = (config.database ?? "").toLowerCase();

  // Defense in depth: the pg-parsed connect host MUST equal the WHATWG authority
  // host. Any divergence means the host was manipulated (percent-encoding, a
  // smuggled override the param-scan somehow missed) — refuse.
  const whatwgHost = normHost(whatwgUrl.hostname);
  if (pgHost !== whatwgHost) {
    return refuse(
      pgHost,
      `the host pg will connect to ('${pgHost}') differs from the URL's authority host ('${whatwgHost}') — ` +
        "refusing a manipulated/percent-encoded host. Provide a plain, unescaped host.",
      flags,
    );
  }

  // 1. Main-like markers: substring match, deliberately over-broad.
  for (const marker of MAIN_LIKE_MARKERS) {
    if (pgHost.includes(marker)) {
      return refuse(
        pgHost,
        `host '${pgHost}' contains the main-like marker '${marker}' — refusing (this suite must NEVER touch a main/production target)`,
        flags,
      );
    }
    if (database.includes(marker)) {
      return refuse(
        pgHost,
        `database '${database}' contains the main-like marker '${marker}' — refusing (this suite must NEVER touch a main/production target)`,
        flags,
      );
    }
  }

  // 2. Affirmative non-main discriminator: clean token in host or database.
  const candidateTokens = new Set([...tokens(pgHost), ...tokens(database)]);
  const discriminator = NON_MAIN_TOKENS.find((t) => candidateTokens.has(t));
  if (!discriminator) {
    return refuse(
      pgHost,
      `neither host '${pgHost}' nor database '${database}' carries a verifiable non-main branch discriminator ` +
        `(expected one of: ${NON_MAIN_TOKENS.join(", ")} as a clean token) — refusing. ` +
        "Name the preview branch's database or endpoint so the target is self-evidently not main.",
      flags,
    );
  }

  // 3. Second factor: the operator must echo the EXACT pg-parsed connect host.
  const confirm = env.ACCEPTANCE_CONFIRM_NON_MAIN;
  if (confirm === undefined || confirm.length === 0) {
    return refuse(
      pgHost,
      `ACCEPTANCE_CONFIRM_NON_MAIN is not set — set it to exactly '${pgHost}' to confirm this is a non-main target`,
      flags,
    );
  }
  if (normHost(confirm) !== pgHost) {
    return refuse(
      pgHost,
      `ACCEPTANCE_CONFIRM_NON_MAIN ('${confirm}') does not match the target host ('${pgHost}') — refusing`,
      flags,
    );
  }

  return {
    ok: true,
    host: pgHost,
    reason: null,
    applyMigrations: flags.applyMigrations,
    runSmoke: flags.runSmoke,
    config,
  };
}
