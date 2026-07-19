import { describe, expect, it } from "vitest";
import {
  RuntimeConfigError,
  assertRuntimeReady,
  describeRuntimeReadiness,
  isPreviewDatabase,
  isPreviewDatabaseUrl,
  resolveRuntimeConfig,
  resolveRuntimeMode,
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
    for (const mode of ["production", "preview", "development", "test"] as const) {
      expect(resolveRuntimeMode({ APP_ENV: mode })).toBe(mode);
    }
    expect(resolveRuntimeMode({ APP_ENV: "PRODUCTION" })).toBe("production"); // case-insensitive
  });

  it("NEVER infers production from a hosting signal — only explicit APP_ENV", () => {
    // The critical safety property: a prototype on Vercel production must not fail closed.
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

describe("resolveRuntimeConfig — non-production is permissive", () => {
  it("allows demo/mock/synthetic in development with no problems", () => {
    const result = resolveRuntimeConfig({}); // all defaults, mode=development
    expect(result.mode).toBe("development");
    expect(result.ok).toBe(true);
    expect(result.problems).toEqual([]);
    expect(result.readiness.authMode).toBe("demo");
    expect(result.readiness.repositoryMode).toBe("memory");
    expect(result.readiness.seedMode).toBe("synthetic");
  });

  it("allows demo/mock in preview too", () => {
    expect(resolveRuntimeConfig({ VERCEL_ENV: "preview" }).ok).toBe(true);
    expect(resolveRuntimeConfig({ APP_ENV: "test" }).ok).toBe(true);
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
    expect(joined).toMatch(/SEED_MODE must be 'off'/);
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

  it("never throws outside production, even with nothing configured", () => {
    expect(() => assertRuntimeReady({})).not.toThrow();
    expect(() => assertRuntimeReady({ VERCEL_ENV: "preview" })).not.toThrow();
  });
});
