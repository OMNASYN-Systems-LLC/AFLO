/**
 * Production runtime contract (production-conversion directive, Phase 2).
 *
 * The single source of truth for "may this process run, in this mode, with this
 * configuration?" — and, in production, the NON-NEGOTIABLE fail-closed guard:
 * production must never silently fall back to demo identities, mock
 * repositories, in-memory state, synthetic data, mock delivery, public document
 * storage, a preview database, or an ephemeral signing key.
 *
 * Pure and deterministic — it only reads an env-like map and returns a verdict;
 * it opens no connection and holds no secret. Deep validation of any single
 * integration (e.g. the Neon two-URL parse) stays in that integration's own
 * config (`@aflo/database` getDatabaseConfig); this contract is the lighter,
 * broader BOOT gate that decides which providers are even allowed.
 *
 * IMPORTANT: production mode is only ever entered by an EXPLICIT
 * `APP_ENV=production`. It is never inferred from a hosting signal (e.g.
 * `VERCEL_ENV=production`), so a prototype deployment can never silently become
 * "production" and fail closed. Going live is a deliberate act.
 */

export const RUNTIME_MODES = ["test", "development", "preview", "production"] as const;
export type RuntimeMode = (typeof RUNTIME_MODES)[number];

/** How the process authenticates users. */
export type AuthMode = "demo" | "clerk";
/** Which repository implementation backs the store. */
export type RepositoryMode = "memory" | "postgres";
/** Whether synthetic seed data may be materialized. */
export type SeedMode = "synthetic" | "off";
/** How notifications are delivered. */
export type EmailMode = "mock" | "resend";
/** Whether protected documents sit behind a private, signed-URL provider. */
export type StorageMode = "public" | "private";

/** A minimal read-only view of the environment (so callers can pass a fixture). */
export type EnvLike = Record<string, string | undefined>;

function has(env: EnvLike, key: string): boolean {
  const v = env[key];
  return typeof v === "string" && v.trim().length > 0;
}

/**
 * Resolve the runtime mode. `APP_ENV` is authoritative when it names a known
 * mode; otherwise we degrade to a NON-production default (`test` under
 * `NODE_ENV=test`, `preview` under `VERCEL_ENV=preview`, else `development`).
 * Production is NEVER inferred — it requires an explicit `APP_ENV=production`.
 */
export function resolveRuntimeMode(env: EnvLike): RuntimeMode {
  const appEnv = env.APP_ENV?.trim().toLowerCase();
  if (appEnv && (RUNTIME_MODES as readonly string[]).includes(appEnv)) {
    return appEnv as RuntimeMode;
  }
  if (env.NODE_ENV === "test") return "test";
  if (env.VERCEL_ENV === "preview") return "preview";
  return "development";
}

// --- Provider selection (safe, dev-friendly defaults; production re-checks them) ---

/** Demo auth unless Clerk is explicitly selected. */
export function resolveAuthMode(env: EnvLike): AuthMode {
  return env.AUTH_MODE?.trim().toLowerCase() === "clerk" ? "clerk" : "demo";
}
/** In-memory repositories unless Postgres is explicitly selected. */
export function resolveRepositoryMode(env: EnvLike): RepositoryMode {
  return env.REPOSITORY_MODE?.trim().toLowerCase() === "postgres" ? "postgres" : "memory";
}
/** Synthetic seed unless explicitly turned off. */
export function resolveSeedMode(env: EnvLike): SeedMode {
  return env.SEED_MODE?.trim().toLowerCase() === "off" ? "off" : "synthetic";
}
/** Mock delivery unless a real provider is explicitly selected. */
export function resolveEmailMode(env: EnvLike): EmailMode {
  return env.EMAIL_MODE?.trim().toLowerCase() === "resend" ? "resend" : "mock";
}
/** Public storage unless a private provider is explicitly selected (unsafe default is flagged in production). */
export function resolveStorageMode(env: EnvLike): StorageMode {
  return env.STORAGE_MODE?.trim().toLowerCase() === "private" ? "private" : "public";
}

// --- Integration presence checks (light: presence, not deep validation) ---

function databaseConfigured(env: EnvLike): boolean {
  return has(env, "DATABASE_URL") && has(env, "DIRECT_DATABASE_URL");
}
function authConfigured(env: EnvLike): boolean {
  return (
    has(env, "CLERK_SECRET_KEY") &&
    has(env, "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY") &&
    has(env, "CLERK_WEBHOOK_SECRET")
  );
}
function storageConfigured(env: EnvLike): boolean {
  return (
    has(env, "STORAGE_PROVIDER") &&
    has(env, "STORAGE_BUCKET") &&
    (has(env, "STORAGE_SIGNING_SECRET") || has(env, "STORAGE_CREDENTIALS"))
  );
}
function emailConfigured(env: EnvLike): boolean {
  return has(env, "RESEND_API_KEY") && has(env, "RESEND_FROM_EMAIL");
}
function workerConfigured(env: EnvLike): boolean {
  return has(env, "WORKER_SECRET");
}
function observabilityConfigured(env: EnvLike): boolean {
  return has(env, "SENTRY_DSN") && has(env, "NEXT_PUBLIC_SENTRY_DSN");
}
function encryptionConfigured(env: EnvLike): boolean {
  return has(env, "ENCRYPTION_KEY_REFERENCE");
}

/**
 * Heuristic: does the database URL *look* like a preview branch? Neon endpoint
 * hostnames are randomly generated and NOT derived from the branch name, so a
 * real preview-branch URL often contains no "preview" substring at all — this
 * is a weak fallback signal only, never a proof.
 */
export function isPreviewDatabaseUrl(env: EnvLike): boolean {
  const url = env.DATABASE_URL?.toLowerCase() ?? "";
  return url.length > 0 && url.includes("preview");
}

/**
 * Is the configured database a preview branch? An explicit `DATABASE_BRANCH` is
 * authoritative (the reliable signal — set it in the deployment); absent that we
 * fall back to the weak URL heuristic. This lets a deployment prove
 * "this is the production branch" (`DATABASE_BRANCH=main`) even when the Neon
 * host string is opaque, and prevents a false positive when a production host
 * legitimately contains "preview".
 */
export function isPreviewDatabase(env: EnvLike): boolean {
  const branch = env.DATABASE_BRANCH?.trim().toLowerCase();
  // Substring, not exact-match: this fails closed for any preview-ish branch name
  // (e.g. "preview-2") while the canonical production/dev branches ("main"/"dev")
  // never contain "preview". An empty/whitespace value falls through to the URL heuristic.
  if (branch) return branch.includes("preview");
  return isPreviewDatabaseUrl(env);
}

/**
 * Non-secret readiness snapshot — booleans and selected modes ONLY, never a
 * secret value. Safe to serialize to a health endpoint.
 */
export interface RuntimeReadiness {
  mode: RuntimeMode;
  authMode: AuthMode;
  repositoryMode: RepositoryMode;
  seedMode: SeedMode;
  emailMode: EmailMode;
  storageMode: StorageMode;
  databaseConfigured: boolean;
  authConfigured: boolean;
  storageConfigured: boolean;
  emailConfigured: boolean;
  workerConfigured: boolean;
  observabilityConfigured: boolean;
  encryptionConfigured: boolean;
}

/** Build the non-secret readiness snapshot. Exposes no secret values. */
export function describeRuntimeReadiness(env: EnvLike): RuntimeReadiness {
  return {
    mode: resolveRuntimeMode(env),
    authMode: resolveAuthMode(env),
    repositoryMode: resolveRepositoryMode(env),
    seedMode: resolveSeedMode(env),
    emailMode: resolveEmailMode(env),
    storageMode: resolveStorageMode(env),
    databaseConfigured: databaseConfigured(env),
    authConfigured: authConfigured(env),
    storageConfigured: storageConfigured(env),
    emailConfigured: emailConfigured(env),
    workerConfigured: workerConfigured(env),
    observabilityConfigured: observabilityConfigured(env),
    encryptionConfigured: encryptionConfigured(env),
  };
}

export interface RuntimeConfigResult {
  mode: RuntimeMode;
  /** True when nothing is misconfigured for this mode. */
  ok: boolean;
  /** Human-readable fail-closed violations (production only). Names env vars, never values. */
  problems: string[];
  readiness: RuntimeReadiness;
}

/**
 * Evaluate the runtime configuration. Outside production this is permissive —
 * dev/preview/test may use demo auth, mock repositories, and synthetic seed. In
 * production it fails closed: every forbidden fallback and every missing
 * required integration becomes a `problem`, and `ok` is false unless the list
 * is empty.
 */
export function resolveRuntimeConfig(env: EnvLike): RuntimeConfigResult {
  const readiness = describeRuntimeReadiness(env);
  const problems: string[] = [];

  if (readiness.mode === "production") {
    // Forbidden fallbacks — production must use real providers.
    if (readiness.authMode !== "clerk") {
      problems.push("AUTH_MODE must be 'clerk' in production — demo identities are forbidden.");
    }
    if (readiness.repositoryMode !== "postgres") {
      problems.push("REPOSITORY_MODE must be 'postgres' in production — mock/in-memory repositories are forbidden.");
    }
    if (readiness.seedMode !== "off") {
      problems.push("SEED_MODE must be 'off' in production — synthetic seed data is forbidden.");
    }
    if (readiness.emailMode === "mock") {
      problems.push("EMAIL_MODE must be a real provider in production — mock delivery is forbidden.");
    }
    if (readiness.storageMode !== "private") {
      problems.push("STORAGE_MODE must be 'private' in production — public document storage is forbidden.");
    }

    // Required integrations — production must be fully configured.
    if (!readiness.databaseConfigured) {
      problems.push("DATABASE_URL and DIRECT_DATABASE_URL are required in production.");
    }
    if (isPreviewDatabase(env)) {
      problems.push("The database looks like a preview branch (DATABASE_BRANCH=preview or a preview-looking URL) — production must use the production database branch.");
    }
    if (!readiness.authConfigured) {
      problems.push("Clerk keys (CLERK_SECRET_KEY, NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, CLERK_WEBHOOK_SECRET) are required in production.");
    }
    if (!readiness.storageConfigured) {
      problems.push("Private storage config (STORAGE_PROVIDER, STORAGE_BUCKET, and a signing secret or credentials) is required in production.");
    }
    if (readiness.emailMode === "resend" && !readiness.emailConfigured) {
      problems.push("RESEND_API_KEY and RESEND_FROM_EMAIL are required when EMAIL_MODE='resend'.");
    }
    if (!readiness.encryptionConfigured) {
      problems.push("ENCRYPTION_KEY_REFERENCE is required in production — ephemeral production signing keys are forbidden.");
    }
    if (!readiness.workerConfigured) {
      problems.push("WORKER_SECRET is required in production.");
    }
    if (!readiness.observabilityConfigured) {
      problems.push("Sentry DSNs (SENTRY_DSN, NEXT_PUBLIC_SENTRY_DSN) are required in production.");
    }
  }

  return { mode: readiness.mode, ok: problems.length === 0, problems, readiness };
}

/** Thrown by `assertRuntimeReady` when production configuration is invalid. */
export class RuntimeConfigError extends Error {
  readonly mode: RuntimeMode;
  readonly problems: string[];
  constructor(mode: RuntimeMode, problems: string[]) {
    super(
      `Runtime configuration is invalid for mode '${mode}':\n` +
        problems.map((p) => `  - ${p}`).join("\n"),
    );
    this.name = "RuntimeConfigError";
    this.mode = mode;
    this.problems = problems;
  }
}

/**
 * The fail-closed boot gate: return the resolved config, or THROW
 * `RuntimeConfigError` if it is invalid (only possible in production). Call this
 * at process startup so a misconfigured production deployment refuses to serve
 * rather than silently degrading to demo/mock.
 */
export function assertRuntimeReady(env: EnvLike): RuntimeConfigResult {
  const result = resolveRuntimeConfig(env);
  if (!result.ok) throw new RuntimeConfigError(result.mode, result.problems);
  return result;
}
