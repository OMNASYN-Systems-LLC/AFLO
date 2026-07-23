import { describe, expect, it } from "vitest";
import { resolveMessagingUiRuntime } from "../src/messaging/ui-gateway";
import {
  RuntimeConfigError,
  assertRuntimeReady,
  describeRuntimeReadiness,
  isDemoRuntimePermitted,
  isPreviewDatabase,
  isPreviewDatabaseUrl,
  resolveAuthMode,
  resolveRepositoryMode,
  resolveRuntimeConfig,
  resolveRuntimeMode,
  resolveSeedMode,
  type EnvLike,
} from "../src/runtime/runtime";

/** A fully-configured, valid production environment. */
const PROD_OK: EnvLike = {
  APP_ENV: "production",
  AUTH_MODE: "clerk",
  REPOSITORY_MODE: "postgres",
  SEED_MODE: "off",
  EMAIL_MODE: "resend",
  STORAGE_MODE: "private",
  DATABASE_URL: "postgres://u:p@db.host/proddb",
  DIRECT_DATABASE_URL: "postgres://u:p@db.host/proddb",
  CLERK_SECRET_KEY: "sk_live_secret",
  NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY: "pk_live_pub",
  CLERK_WEBHOOK_SECRET: "whsec_secret",
  RESEND_API_KEY: "re_secret",
  RESEND_FROM_EMAIL: "no-reply@example.test",
  STORAGE_PROVIDER: "s3",
  STORAGE_BUCKET: "aflo-docs",
  STORAGE_SIGNING_SECRET: "storage_secret",
  SENTRY_DSN: "https://sentry.example.test/1",
  NEXT_PUBLIC_SENTRY_DSN: "https://sentry.example.test/1",
  WORKER_SECRET: "worker_secret",
  ENCRYPTION_KEY_REFERENCE: "kms://alias/aflo",
};

describe("resolveRuntimeMode", () => {
  it("honors an explicit APP_ENV for every known mode", () => {
    for (const mode of ["production", "preview", "demo", "development", "test"] as const) {
      expect(resolveRuntimeMode({ APP_ENV: mode })).toBe(mode);
    }
    expect(resolveRuntimeMode({ APP_ENV: "PRODUCTION" })).toBe("production"); // case-insensitive
    expect(resolveRuntimeMode({ APP_ENV: "DEMO" })).toBe("demo");
  });

  it("NEVER infers production from a hosting signal — only explicit APP_ENV", () => {
    expect(resolveRuntimeMode({ VERCEL_ENV: "production" })).toBe("development");
    expect(resolveRuntimeMode({ NODE_ENV: "production" })).toBe("development");
  });

  it("degrades to non-production defaults without APP_ENV", () => {
    expect(resolveRuntimeMode({ NODE_ENV: "test" })).toBe("test");
    expect(resolveRuntimeMode({ VERCEL_ENV: "preview" })).toBe("preview");
    expect(resolveRuntimeMode({})).toBe("development");
    expect(resolveRuntimeMode({ APP_ENV: "nonsense" })).toBe("development");
  });
});

describe("isDemoRuntimePermitted — the EXPLICIT demo opt-in (ADR-0048)", () => {
  it("permits demo only under the explicit APP_ENV=demo opt-in or automated tests", () => {
    expect(isDemoRuntimePermitted({ APP_ENV: "demo" })).toBe(true);
    expect(isDemoRuntimePermitted({ NODE_ENV: "test" })).toBe(true);
    expect(isDemoRuntimePermitted({ APP_ENV: "test" })).toBe(true);
  });

  it("NEVER permits demo implicitly — no hosting signal, no empty env, no partial config", () => {
    expect(isDemoRuntimePermitted({})).toBe(false);
    expect(isDemoRuntimePermitted({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isDemoRuntimePermitted({ VERCEL_ENV: "production" })).toBe(false);
    expect(isDemoRuntimePermitted({ APP_ENV: "development" })).toBe(false);
    expect(isDemoRuntimePermitted({ APP_ENV: "preview" })).toBe(false);
    expect(isDemoRuntimePermitted({ APP_ENV: "production" })).toBe(false);
    expect(isDemoRuntimePermitted({ AUTH_MODE: "demo", REPOSITORY_MODE: "memory" })).toBe(false);
  });
});

describe("provider resolution — explicit, never an implicit demo default (ADR-0048)", () => {
  it("resolves demo-family values ONLY under the opt-in", () => {
    expect(resolveAuthMode({ APP_ENV: "demo" })).toBe("demo");
    expect(resolveAuthMode({ APP_ENV: "demo", AUTH_MODE: "demo" })).toBe("demo");
    expect(resolveRepositoryMode({ APP_ENV: "demo" })).toBe("memory");
    expect(resolveSeedMode({ APP_ENV: "demo" })).toBe("synthetic");
    expect(resolveSeedMode({ APP_ENV: "demo", SEED_MODE: "off" })).toBe("off");
  });

  it("resolves 'unresolved'/'off' when nothing is selected and there is no opt-in", () => {
    expect(resolveAuthMode({})).toBe("unresolved");
    expect(resolveRepositoryMode({})).toBe("unresolved");
    expect(resolveSeedMode({})).toBe("off");
    // Even an EXPLICIT demo-family value cannot activate without the opt-in.
    expect(resolveAuthMode({ AUTH_MODE: "demo" })).toBe("unresolved");
    expect(resolveRepositoryMode({ REPOSITORY_MODE: "memory" })).toBe("unresolved");
    expect(resolveSeedMode({ SEED_MODE: "synthetic" })).toBe("off");
  });

  it("resolves the real providers whenever explicitly selected (opt-in or not)", () => {
    expect(resolveAuthMode({ AUTH_MODE: "clerk" })).toBe("clerk");
    expect(resolveRepositoryMode({ REPOSITORY_MODE: "postgres" })).toBe("postgres");
    // A contradictory demo opt-in never silently downgrades a real selection —
    // the contradiction fails the boot instead (see resolveRuntimeConfig).
    expect(resolveAuthMode({ APP_ENV: "demo", AUTH_MODE: "clerk" })).toBe("clerk");
  });
});

describe("resolveRuntimeConfig — the explicit demo mode (ADR-0048)", () => {
  it("accepts the plain demo opt-in", () => {
    const result = resolveRuntimeConfig({ APP_ENV: "demo" });
    expect(result.mode).toBe("demo");
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.readiness.authMode).toBe("demo");
    expect(result.readiness.repositoryMode).toBe("memory");
    expect(result.readiness.seedMode).toBe("synthetic");
  });

  it("rejects a contradictory real selection inside the demo runtime", () => {
    const clerk = resolveRuntimeConfig({ APP_ENV: "demo", AUTH_MODE: "clerk" });
    expect(clerk.ok).toBe(false);
    expect(clerk.problems.join()).toMatch(/AUTH_MODE=clerk/);

    const pg = resolveRuntimeConfig({ APP_ENV: "demo", REPOSITORY_MODE: "postgres" });
    expect(pg.ok).toBe(false);
    expect(pg.problems.join()).toMatch(/REPOSITORY_MODE=postgres/);
  });

  it("keeps test mode permissive (automated tests only — never a hosted deployment)", () => {
    expect(resolveRuntimeConfig({ APP_ENV: "test" }).ok).toBe(true);
    expect(resolveRuntimeConfig({ NODE_ENV: "test" }).ok).toBe(true);
  });
});

describe("resolveRuntimeConfig — development/preview fail closed without an explicit runtime (LOW-5)", () => {
  it("rejects the empty environment — demo is no longer the implicit default", () => {
    const result = resolveRuntimeConfig({});
    expect(result.mode).toBe("development");
    expect(result.ok).toBe(false);
    const joined = result.problems.join("\n");
    expect(joined).toMatch(/AUTH_MODE is unresolved/);
    expect(joined).toMatch(/REPOSITORY_MODE is unresolved/);
  });

  it("rejects the LOW-5 cells: production intent with one mode variable forgotten", () => {
    // Intended production, forgot APP_ENV=production AND REPOSITORY_MODE.
    const authOnly = resolveRuntimeConfig({ AUTH_MODE: "clerk" });
    expect(authOnly.ok).toBe(false);
    expect(authOnly.problems.join()).toMatch(/REPOSITORY_MODE is unresolved/);

    // Intended production, forgot APP_ENV=production AND AUTH_MODE.
    const repoOnly = resolveRuntimeConfig({ REPOSITORY_MODE: "postgres" });
    expect(repoOnly.ok).toBe(false);
    expect(repoOnly.problems.join()).toMatch(/AUTH_MODE is unresolved/);

    // Same on a Vercel preview deployment.
    expect(resolveRuntimeConfig({ VERCEL_ENV: "preview" }).ok).toBe(false);
    expect(resolveRuntimeConfig({ VERCEL_ENV: "preview", AUTH_MODE: "clerk" }).ok).toBe(false);
  });

  it("rejects explicit demo-family values without the opt-in, naming the fix", () => {
    const demoAuth = resolveRuntimeConfig({ AUTH_MODE: "demo", REPOSITORY_MODE: "memory" });
    expect(demoAuth.ok).toBe(false);
    expect(demoAuth.problems.join("\n")).toMatch(/AUTH_MODE=demo requires the explicit demo opt-in APP_ENV=demo/);
    expect(demoAuth.problems.join("\n")).toMatch(/REPOSITORY_MODE=memory requires the explicit demo opt-in APP_ENV=demo/);

    const seed = resolveRuntimeConfig({ AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres", SEED_MODE: "synthetic" });
    expect(seed.ok).toBe(false);
    expect(seed.problems.join()).toMatch(/SEED_MODE=synthetic requires the explicit demo opt-in/);
  });

  it("accepts an explicitly selected real runtime in development/preview (routes gate the rest)", () => {
    const dev = resolveRuntimeConfig({ AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres" });
    expect(dev.mode).toBe("development");
    expect(dev.ok).toBe(true);

    const preview = resolveRuntimeConfig({
      VERCEL_ENV: "preview",
      AUTH_MODE: "clerk",
      REPOSITORY_MODE: "postgres",
    });
    expect(preview.mode).toBe("preview");
    expect(preview.ok).toBe(true);
  });

  it("accepts the explicit demo opt-in on a preview deployment (the intentional demo preview)", () => {
    const result = resolveRuntimeConfig({ VERCEL_ENV: "preview", APP_ENV: "demo" });
    expect(result.mode).toBe("demo");
    expect(result.ok).toBe(true);
  });
});

describe("resolveRuntimeConfig — production fails closed", () => {
  it("rejects the demo/mock/synthetic defaults with no credentials", () => {
    const result = resolveRuntimeConfig({ APP_ENV: "production" });
    expect(result.mode).toBe("production");
    expect(result.ok).toBe(false);
    const joined = result.problems.join("\n");
    expect(joined).toMatch(/AUTH_MODE must be 'clerk'/);
    expect(joined).toMatch(/REPOSITORY_MODE must be 'postgres'/);
    // ADR-0048: an unset SEED_MODE now resolves 'off' (absence never implies
    // synthetic), so the seed problem fires only on an EXPLICIT synthetic.
    expect(joined).not.toMatch(/SEED_MODE must be 'off'/);
    expect(joined).toMatch(/EMAIL_MODE must be a real provider/);
    expect(joined).toMatch(/STORAGE_MODE must be 'private'/);
    expect(joined).toMatch(/DATABASE_URL and DIRECT_DATABASE_URL are required/);
    expect(joined).toMatch(/Clerk keys .* are required/);
    expect(joined).toMatch(/Private storage config/);
    expect(joined).toMatch(/ENCRYPTION_KEY_REFERENCE is required/);
    expect(joined).toMatch(/WORKER_SECRET is required/);
    expect(joined).toMatch(/Sentry DSNs/);
  });

  it("accepts a fully-configured production environment", () => {
    const result = resolveRuntimeConfig(PROD_OK);
    expect(result.mode).toBe("production");
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
  });

  it("flags each forbidden fallback individually", () => {
    const demo = resolveRuntimeConfig({ ...PROD_OK, AUTH_MODE: "demo" });
    expect(demo.ok).toBe(false);
    expect(demo.problems.join()).toMatch(/demo identities are forbidden/);

    const mock = resolveRuntimeConfig({ ...PROD_OK, REPOSITORY_MODE: "memory" });
    expect(mock.problems.join()).toMatch(/mock\/in-memory repositories are forbidden/);

    const seed = resolveRuntimeConfig({ ...PROD_OK, SEED_MODE: "synthetic" });
    expect(seed.problems.join()).toMatch(/synthetic seed data is forbidden/);

    const pub = resolveRuntimeConfig({ ...PROD_OK, STORAGE_MODE: "public" });
    expect(pub.problems.join()).toMatch(/public document storage is forbidden/);

    const email = resolveRuntimeConfig({ ...PROD_OK, EMAIL_MODE: "mock" });
    expect(email.problems.join()).toMatch(/mock delivery is forbidden/);
  });

  it("rejects a preview database branch in production (URL heuristic fallback)", () => {
    const preview = resolveRuntimeConfig({
      ...PROD_OK,
      DATABASE_URL: "postgres://u:p@ep-preview-branch.host/db",
    });
    expect(preview.ok).toBe(false);
    expect(preview.problems.join()).toMatch(/preview branch/);
    expect(isPreviewDatabaseUrl({ DATABASE_URL: "postgres://ep-preview-x/db" })).toBe(true);
    expect(isPreviewDatabaseUrl({ DATABASE_URL: "postgres://ep-prod-x/db" })).toBe(false);
  });

  it("uses DATABASE_BRANCH as the authoritative preview signal", () => {
    // A real Neon preview URL need not contain "preview" — the explicit branch catches it.
    expect(isPreviewDatabase({ DATABASE_BRANCH: "preview", DATABASE_URL: "postgres://ep-random-xyz/db" })).toBe(true);
    const flagged = resolveRuntimeConfig({ ...PROD_OK, DATABASE_BRANCH: "preview" });
    expect(flagged.ok).toBe(false);
    expect(flagged.problems.join()).toMatch(/preview branch/);
    // Any preview-ish branch name fails closed (substring, not exact-match).
    expect(isPreviewDatabase({ DATABASE_BRANCH: "preview-2" })).toBe(true);
    // An explicit main/dev branch overrides a preview-looking URL (no false positive).
    expect(isPreviewDatabase({ DATABASE_BRANCH: "main", DATABASE_URL: "postgres://ep-preview-name/db" })).toBe(false);
    expect(isPreviewDatabase({ DATABASE_BRANCH: "dev" })).toBe(false);
    expect(resolveRuntimeConfig({ ...PROD_OK, DATABASE_BRANCH: "main", DATABASE_URL: "postgres://ep-preview-name/db" }).ok).toBe(true);
    // Absent DATABASE_BRANCH, it falls back to the URL heuristic.
    expect(isPreviewDatabase({ DATABASE_URL: "postgres://ep-preview-x/db" })).toBe(true);
  });

  it("requires Resend credentials when EMAIL_MODE=resend", () => {
    const noResend: EnvLike = { ...PROD_OK };
    delete noResend.RESEND_API_KEY;
    delete noResend.RESEND_FROM_EMAIL;
    const result = resolveRuntimeConfig(noResend);
    expect(result.problems.join()).toMatch(/RESEND_API_KEY and RESEND_FROM_EMAIL are required/);
  });
});

describe("describeRuntimeReadiness — non-secret", () => {
  it("exposes booleans and modes only, never a secret value", () => {
    const readiness = describeRuntimeReadiness(PROD_OK);
    expect(readiness.databaseConfigured).toBe(true);
    expect(readiness.authConfigured).toBe(true);
    expect(readiness.mode).toBe("production");
    const serialized = JSON.stringify(readiness);
    // None of the secret VALUES may appear in the readiness snapshot.
    for (const secret of [
      "sk_live_secret",
      "pk_live_pub",
      "whsec_secret",
      "re_secret",
      "storage_secret",
      "worker_secret",
      "kms://alias/aflo",
      "postgres://u:p@db.host/proddb",
    ]) {
      expect(serialized).not.toContain(secret);
    }
  });

  it("reports each integration as unconfigured when absent", () => {
    const readiness = describeRuntimeReadiness({});
    expect(readiness.databaseConfigured).toBe(false);
    expect(readiness.authConfigured).toBe(false);
    expect(readiness.storageConfigured).toBe(false);
    expect(readiness.emailConfigured).toBe(false);
    expect(readiness.workerConfigured).toBe(false);
    expect(readiness.observabilityConfigured).toBe(false);
    expect(readiness.encryptionConfigured).toBe(false);
  });
});

describe("assertRuntimeReady — the fail-closed boot gate", () => {
  it("throws RuntimeConfigError for a misconfigured production env", () => {
    expect(() => assertRuntimeReady({ APP_ENV: "production" })).toThrow(RuntimeConfigError);
    try {
      assertRuntimeReady({ APP_ENV: "production" });
    } catch (e) {
      expect(e).toBeInstanceOf(RuntimeConfigError);
      expect((e as RuntimeConfigError).mode).toBe("production");
      expect((e as RuntimeConfigError).problems.length).toBeGreaterThan(0);
    }
  });

  it("returns the config for a valid production env", () => {
    expect(assertRuntimeReady(PROD_OK).ok).toBe(true);
  });

  it("throws for the ambiguous (implicit-demo) deployments — the LOW-5 fix (ADR-0048)", () => {
    expect(() => assertRuntimeReady({})).toThrow(RuntimeConfigError);
    expect(() => assertRuntimeReady({ VERCEL_ENV: "preview" })).toThrow(RuntimeConfigError);
    expect(() => assertRuntimeReady({ AUTH_MODE: "clerk" })).toThrow(RuntimeConfigError);
    expect(() => assertRuntimeReady({ REPOSITORY_MODE: "postgres" })).toThrow(RuntimeConfigError);
  });

  it("never throws for the explicit demo opt-in, test mode, or an explicit real selection", () => {
    expect(() => assertRuntimeReady({ APP_ENV: "demo" })).not.toThrow();
    expect(() => assertRuntimeReady({ NODE_ENV: "test" })).not.toThrow();
    expect(() =>
      assertRuntimeReady({ AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres" }),
    ).not.toThrow();
  });
});

describe("ADR-0048 truth table — every cell lands in exactly one of demo | real | fail-closed", () => {
  // The demo opt-in shares the APP_ENV axis (APP_ENV=demo), so the required
  // APP_ENV × opt-in × AUTH_MODE × REPOSITORY_MODE table collapses to
  // APP_ENV × AUTH_MODE × REPOSITORY_MODE. "unset" exercises every implicit
  // cell — including the LOW-5 hazard cells.
  const APP_ENVS = [undefined, "demo", "development", "preview", "production", "test"] as const;
  const AUTH_MODES = [undefined, "demo", "clerk"] as const;
  const REPO_MODES = [undefined, "memory", "postgres"] as const;

  /** Full integration config so a coherent production cell can be "real". */
  const INTEGRATIONS: EnvLike = (() => {
    const base = { ...PROD_OK };
    delete base.APP_ENV;
    delete base.AUTH_MODE;
    delete base.REPOSITORY_MODE;
    delete base.SEED_MODE;
    return base;
  })();

  type Cell = { env: EnvLike; appEnv?: string; authMode?: string; repoMode?: string };
  function cells(withIntegrations: boolean): Cell[] {
    const out: Cell[] = [];
    for (const appEnv of APP_ENVS) {
      for (const authMode of AUTH_MODES) {
        for (const repoMode of REPO_MODES) {
          const env: EnvLike = withIntegrations ? { ...INTEGRATIONS } : {};
          if (appEnv !== undefined) env.APP_ENV = appEnv;
          if (authMode !== undefined) env.AUTH_MODE = authMode;
          if (repoMode !== undefined) env.REPOSITORY_MODE = repoMode;
          out.push({ env, appEnv, authMode, repoMode });
        }
      }
    }
    return out;
  }

  /** Total classifier: what does this configuration actually run as? */
  function classify(env: EnvLike): "demo" | "real" | "fail-closed" {
    const config = resolveRuntimeConfig(env);
    if (!config.ok) return "fail-closed"; // boot refuses (instrumentation.ts)
    const { authMode, repositoryMode } = config.readiness;
    if (authMode === "clerk" && repositoryMode === "postgres") return "real";
    if (isDemoRuntimePermitted(env)) return "demo"; // explicit opt-in (or tests)
    return "fail-closed"; // boot ok but incoherent axes — must be unreachable
  }

  it("NO cell serves demo without the explicit opt-in (the LOW-5 invariant)", () => {
    for (const withIntegrations of [false, true]) {
      for (const { env, appEnv, authMode, repoMode } of cells(withIntegrations)) {
        const cls = classify(env);
        const label = `APP_ENV=${appEnv} AUTH_MODE=${authMode} REPOSITORY_MODE=${repoMode} integrations=${withIntegrations}`;
        if (cls === "demo") {
          // Demo data/identity requires the deliberate opt-in — never implicit.
          expect(appEnv === "demo" || appEnv === "test", label).toBe(true);
        }
        // The messaging seam can NEVER select its demo path without the opt-in,
        // even for cells the boot gate refuses (belt-and-braces parity).
        if (resolveMessagingUiRuntime(env) === "demo") {
          expect(isDemoRuntimePermitted(env), label).toBe(true);
        }
        // Synthetic seed can never resolve without the opt-in.
        if (resolveSeedMode(env) === "synthetic") {
          expect(isDemoRuntimePermitted(env), label).toBe(true);
        }
      }
    }
  });

  it("classifies the canonical cells exactly as the ADR-0048 table records", () => {
    // Explicit demo (the opt-in) — demo.
    expect(classify({ APP_ENV: "demo" })).toBe("demo");
    expect(classify({ APP_ENV: "demo", AUTH_MODE: "demo", REPOSITORY_MODE: "memory" })).toBe("demo");
    // Contradictory demo — fail-closed, never a silent pick.
    expect(classify({ APP_ENV: "demo", AUTH_MODE: "clerk" })).toBe("fail-closed");
    expect(classify({ APP_ENV: "demo", REPOSITORY_MODE: "postgres" })).toBe("fail-closed");
    // The LOW-5 hazard cells — fail-closed now, demo before ADR-0048.
    expect(classify({})).toBe("fail-closed");
    expect(classify({ AUTH_MODE: "clerk" })).toBe("fail-closed");
    expect(classify({ REPOSITORY_MODE: "postgres" })).toBe("fail-closed");
    expect(classify({ APP_ENV: "preview", AUTH_MODE: "clerk" })).toBe("fail-closed");
    // Explicit real selection outside production — real (routes gate serving).
    expect(classify({ AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres" })).toBe("real");
    // Production: full config real; anything less fail-closed (ADR-0017).
    expect(classify(PROD_OK)).toBe("real");
    expect(classify({ APP_ENV: "production" })).toBe("fail-closed");
    expect(classify({ APP_ENV: "production", AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres" })).toBe("fail-closed");
  });

  it("the seam agrees with the classifier on every bootable cell", () => {
    for (const withIntegrations of [false, true]) {
      for (const { env, appEnv, authMode, repoMode } of cells(withIntegrations)) {
        const config = resolveRuntimeConfig(env);
        if (!config.ok) continue; // boot refuses; seam parity covered above
        const label = `APP_ENV=${appEnv} AUTH_MODE=${authMode} REPOSITORY_MODE=${repoMode} integrations=${withIntegrations}`;
        const seam = resolveMessagingUiRuntime(env);
        const cls = classify(env);
        expect(seam, label).toBe(cls === "demo" ? "demo" : "persistent");
      }
    }
  });
});
