/**
 * Remote-target hard guard (ADR-0050 — NON-NEGOTIABLE).
 *
 * The acceptance suite may point at a remote database ONLY when the target can
 * be AFFIRMATIVELY determined not to be a main/production branch. The guard
 * fails closed on every ambiguity:
 *
 *  1. The URL must parse as postgres:// or postgresql://.
 *  2. REFUSED outright if the host or database name contains any main-like
 *     marker ("main", "prod", "production", "primary", "live") as a SUBSTRING —
 *     deliberately over-broad; over-refusal is safe, under-refusal is not.
 *  3. REFUSED unless the host or database name carries a verifiable non-main
 *     branch discriminator as a clean TOKEN (split on ./-/_): one of "preview",
 *     "dev", "development", "staging", "test", "branch", "acceptance",
 *     "ephemeral", "sandbox", "localhost", "127". A URL with no recognizable
 *     discriminator is treated as potentially-main and refused. (Token match —
 *     not substring — so an accidental letter run inside an unrelated word can
 *     never satisfy the requirement.)
 *  4. REFUSED unless `ACCEPTANCE_CONFIRM_NON_MAIN` exactly echoes the URL's
 *     host — a second, human-typed factor proving the operator looked at the
 *     specific target.
 *  5. DDL/migrations against a remote target additionally require
 *     `ACCEPTANCE_APPLY_MIGRATIONS=true` (exactly); the default is
 *     VALIDATE-ONLY. The guard only reports this flag — the CLI enforces it.
 *
 * Pure function — evaluating the guard NEVER opens a connection.
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

export interface GuardVerdict {
  ok: boolean;
  /** The parsed host (null when the URL did not parse). */
  host: string | null;
  /** Refusal reason (null when ok). */
  reason: string | null;
  /** True only when ACCEPTANCE_APPLY_MIGRATIONS === "true" (remote DDL opt-in). */
  applyMigrations: boolean;
}

function refuse(host: string | null, reason: string, applyMigrations = false): GuardVerdict {
  return { ok: false, host, reason, applyMigrations };
}

/** Split a host/database name into clean tokens (for the affirmative discriminator). */
function tokens(value: string): string[] {
  return value.split(/[.\-_/]+/).filter((t) => t.length > 0);
}

/**
 * Evaluate whether `rawUrl` is a permissible NON-MAIN acceptance target.
 * Never connects. See the module doc for the full refusal matrix.
 */
export function evaluateRemoteTargetGuard(
  rawUrl: string,
  env: Record<string, string | undefined>,
): GuardVerdict {
  const applyMigrations = env.ACCEPTANCE_APPLY_MIGRATIONS === "true";

  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return refuse(null, "DATABASE_URL_ACCEPTANCE is not a parseable URL");
  }
  if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
    return refuse(null, `refusing non-postgres protocol '${url.protocol}'`);
  }
  const host = url.hostname.toLowerCase();
  if (host.length === 0) return refuse(null, "URL has no host");
  const database = url.pathname.replace(/^\//, "").toLowerCase();

  // 2. Main-like markers: substring match, deliberately over-broad.
  for (const marker of MAIN_LIKE_MARKERS) {
    if (host.includes(marker)) {
      return refuse(host, `host '${host}' contains the main-like marker '${marker}' — refusing (this suite must NEVER touch a main/production target)`, applyMigrations);
    }
    if (database.includes(marker)) {
      return refuse(host, `database '${database}' contains the main-like marker '${marker}' — refusing (this suite must NEVER touch a main/production target)`, applyMigrations);
    }
  }

  // 3. Affirmative non-main discriminator: clean token in host or database.
  const candidateTokens = new Set([...tokens(host), ...tokens(database)]);
  const discriminator = NON_MAIN_TOKENS.find((t) => candidateTokens.has(t));
  if (!discriminator) {
    return refuse(
      host,
      `neither host '${host}' nor database '${database}' carries a verifiable non-main branch discriminator ` +
        `(expected one of: ${NON_MAIN_TOKENS.join(", ")} as a clean token) — refusing. ` +
        "Name the preview branch's database or endpoint so the target is self-evidently not main.",
      applyMigrations,
    );
  }

  // 4. Second factor: the operator must echo the exact host.
  const confirm = env.ACCEPTANCE_CONFIRM_NON_MAIN;
  if (confirm === undefined || confirm.length === 0) {
    return refuse(
      host,
      `ACCEPTANCE_CONFIRM_NON_MAIN is not set — set it to exactly '${host}' to confirm this is a non-main target`,
      applyMigrations,
    );
  }
  if (confirm !== host) {
    return refuse(
      host,
      `ACCEPTANCE_CONFIRM_NON_MAIN ('${confirm}') does not match the target host ('${host}') — refusing`,
      applyMigrations,
    );
  }

  return { ok: true, host, reason: null, applyMigrations };
}
