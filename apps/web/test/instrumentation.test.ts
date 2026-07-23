import { afterEach, describe, expect, it } from "vitest";
import { RuntimeConfigError } from "@aflo/shared";
import { register } from "../src/instrumentation";

/**
 * Boot enforcement (instrumentation.ts) — the fail-closed gate over
 * `assertRuntimeReady` (ADR-0017, flipped to explicit demo opt-in by
 * ADR-0048). These tests drive `register()` itself against process.env
 * fixtures: a production-INTENT misconfiguration (the PR #97 LOW-5 hazard)
 * must refuse to boot, the explicit demo opt-in must boot, and the edge
 * runtime must stay a no-op.
 */

/** Every variable the runtime contract reads (values never matter here). */
const CONTRACT_VARS = [
  "APP_ENV",
  "AUTH_MODE",
  "REPOSITORY_MODE",
  "SEED_MODE",
  "EMAIL_MODE",
  "STORAGE_MODE",
  "NODE_ENV",
  "VERCEL_ENV",
  "NEXT_RUNTIME",
  "DATABASE_URL",
  "DIRECT_DATABASE_URL",
  "DATABASE_BRANCH",
  "CLERK_SECRET_KEY",
  "NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY",
  "CLERK_WEBHOOK_SECRET",
  "RESEND_API_KEY",
  "RESEND_FROM_EMAIL",
  "STORAGE_PROVIDER",
  "STORAGE_BUCKET",
  "STORAGE_SIGNING_SECRET",
  "STORAGE_CREDENTIALS",
  "SENTRY_DSN",
  "NEXT_PUBLIC_SENTRY_DSN",
  "WORKER_SECRET",
  "ENCRYPTION_KEY_REFERENCE",
] as const;

/** Mutable view — Next's types mark NODE_ENV readonly on process.env. */
const mutableEnv = process.env as Record<string, string | undefined>;

const SAVED: Record<string, string | undefined> = {};
for (const key of CONTRACT_VARS) SAVED[key] = mutableEnv[key];

/** Clear every contract variable, then apply the fixture. */
function setEnv(fixture: Record<string, string>): void {
  for (const key of CONTRACT_VARS) delete mutableEnv[key];
  Object.assign(mutableEnv, fixture);
}

afterEach(() => {
  for (const key of CONTRACT_VARS) {
    if (SAVED[key] === undefined) delete mutableEnv[key];
    else mutableEnv[key] = SAVED[key];
  }
});

describe("instrumentation register() — fail-closed boot gate", () => {
  it("REFUSES to boot the LOW-5 hazard: production intent with APP_ENV and one mode variable forgotten", async () => {
    // Operator set AUTH_MODE=clerk (production intent) but forgot
    // APP_ENV=production and REPOSITORY_MODE — pre-ADR-0048 this silently
    // served the demo runtime; now the server never starts.
    setEnv({ NEXT_RUNTIME: "nodejs", AUTH_MODE: "clerk" });
    await expect(register()).rejects.toThrow(RuntimeConfigError);
    await expect(register()).rejects.toThrow(/REPOSITORY_MODE is unresolved/);
  });

  it("REFUSES to boot a fully ambiguous deployment (nothing configured, no opt-in)", async () => {
    setEnv({ NEXT_RUNTIME: "nodejs", VERCEL_ENV: "production" });
    await expect(register()).rejects.toThrow(RuntimeConfigError);
    await expect(register()).rejects.toThrow(/AUTH_MODE is unresolved/);
  });

  it("REFUSES to boot a misconfigured explicit production (ADR-0017, unchanged)", async () => {
    setEnv({ NEXT_RUNTIME: "nodejs", APP_ENV: "production" });
    await expect(register()).rejects.toThrow(RuntimeConfigError);
    await expect(register()).rejects.toThrow(/AUTH_MODE must be 'clerk'/);
  });

  it("REFUSES to boot a contradictory demo runtime (opt-in + real auth selection)", async () => {
    setEnv({ NEXT_RUNTIME: "nodejs", APP_ENV: "demo", AUTH_MODE: "clerk" });
    await expect(register()).rejects.toThrow(RuntimeConfigError);
  });

  it("boots the EXPLICIT demo opt-in (APP_ENV=demo)", async () => {
    setEnv({ NEXT_RUNTIME: "nodejs", APP_ENV: "demo" });
    await expect(register()).resolves.toBeUndefined();
  });

  it("boots an explicitly selected real runtime outside production (routes gate serving)", async () => {
    setEnv({ NEXT_RUNTIME: "nodejs", AUTH_MODE: "clerk", REPOSITORY_MODE: "postgres" });
    await expect(register()).resolves.toBeUndefined();
  });

  it("stays a no-op on the edge runtime (documented gap — no demo/mock providers there)", async () => {
    setEnv({ NEXT_RUNTIME: "edge" }); // otherwise-ambiguous env
    await expect(register()).resolves.toBeUndefined();
  });
});
