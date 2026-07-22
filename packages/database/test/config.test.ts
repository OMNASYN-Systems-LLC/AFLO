import { describe, expect, it } from "vitest";
import {
  DatabaseConfigError,
  getDatabaseConfig,
  isDatabaseConfigured,
  isResolverConfigured,
} from "../src/config";

const POOLED = "postgresql://user:pass@ep-cool-name-123-pooler.us-east-2.aws.neon.tech/aflo?sslmode=require";
const DIRECT = "postgresql://user:pass@ep-cool-name-123.us-east-2.aws.neon.tech/aflo?sslmode=require";
const RESOLVER = "postgresql://resolver:pass@ep-cool-name-123-pooler.us-east-2.aws.neon.tech/aflo?sslmode=require";

describe("isDatabaseConfigured", () => {
  it("is true only when DATABASE_URL is a non-empty string, and never throws", () => {
    expect(isDatabaseConfigured({ DATABASE_URL: POOLED })).toBe(true);
    expect(isDatabaseConfigured({ DATABASE_URL: "" })).toBe(false);
    expect(isDatabaseConfigured({ DATABASE_URL: "   " })).toBe(false);
    expect(isDatabaseConfigured({})).toBe(false);
  });
});

describe("getDatabaseConfig", () => {
  it("parses a valid pooled runtime URL (direct not required)", () => {
    const cfg = getDatabaseConfig({ DATABASE_URL: POOLED });
    expect(cfg.url).toBe(POOLED);
    expect(cfg.host).toBe("ep-cool-name-123-pooler.us-east-2.aws.neon.tech");
    expect(cfg.database).toBe("aflo");
    expect(cfg.sslMode).toBe("require");
    expect(cfg.directUrl).toBeNull(); // absent and not required
  });

  it("captures the direct URL when provided, even for a runtime-only caller", () => {
    const cfg = getDatabaseConfig({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: DIRECT });
    expect(cfg.directUrl).toBe(DIRECT);
  });

  it("requires DIRECT_DATABASE_URL for migration tooling", () => {
    expect(() => getDatabaseConfig({ DATABASE_URL: POOLED }, { requireDirectUrl: true })).toThrow(
      DatabaseConfigError,
    );
    const cfg = getDatabaseConfig({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: DIRECT }, { requireDirectUrl: true });
    expect(cfg.directUrl).toBe(DIRECT);
  });

  it("fails closed when DATABASE_URL is missing", () => {
    expect(() => getDatabaseConfig({})).toThrow(/DATABASE_URL is required/);
  });

  it("rejects a non-URL, a wrong scheme, and a URL with no database name", () => {
    expect(() => getDatabaseConfig({ DATABASE_URL: "not a url" })).toThrow(/not a valid URL/);
    expect(() => getDatabaseConfig({ DATABASE_URL: "mysql://h/db" })).toThrow(/postgres/);
    expect(() => getDatabaseConfig({ DATABASE_URL: "postgresql://host-only" })).toThrow(/missing a database name/);
  });

  it("validates a provided-but-malformed direct URL even when not required", () => {
    expect(() =>
      getDatabaseConfig({ DATABASE_URL: POOLED, DIRECT_DATABASE_URL: "mysql://h/db" }),
    ).toThrow(/DIRECT_DATABASE_URL must use the postgres/);
  });

  it("aggregates every problem into one error (both URLs missing under requireDirectUrl)", () => {
    try {
      getDatabaseConfig({}, { requireDirectUrl: true });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseConfigError);
      const problems = (err as DatabaseConfigError).problems;
      expect(problems.some((p) => p.includes("DATABASE_URL"))).toBe(true);
      expect(problems.some((p) => p.includes("DIRECT_DATABASE_URL"))).toBe(true);
    }
  });

  it("accepts the postgres:// scheme and localhost (dev) without an sslmode", () => {
    const cfg = getDatabaseConfig({ DATABASE_URL: "postgres://localhost:5432/aflo_dev" });
    expect(cfg.database).toBe("aflo_dev");
    expect(cfg.host).toBe("localhost");
    expect(cfg.sslMode).toBeNull();
  });
});

describe("resolver URL (AUTH_RESOLVER_DATABASE_URL)", () => {
  it("isResolverConfigured is true only for a non-empty string, and never throws", () => {
    expect(isResolverConfigured({ AUTH_RESOLVER_DATABASE_URL: RESOLVER })).toBe(true);
    expect(isResolverConfigured({ AUTH_RESOLVER_DATABASE_URL: "  " })).toBe(false);
    expect(isResolverConfigured({})).toBe(false);
  });

  it("is null when not required and not provided", () => {
    expect(getDatabaseConfig({ DATABASE_URL: POOLED }).resolverUrl).toBeNull();
  });

  it("parses when provided; fails closed when required-but-missing", () => {
    const cfg = getDatabaseConfig(
      { DATABASE_URL: POOLED, AUTH_RESOLVER_DATABASE_URL: RESOLVER },
      { requireResolverUrl: true },
    );
    expect(cfg.resolverUrl).toBe(RESOLVER);
    expect(() => getDatabaseConfig({ DATABASE_URL: POOLED }, { requireResolverUrl: true })).toThrow(
      /AUTH_RESOLVER_DATABASE_URL is required/,
    );
  });

  it("validates a provided-but-malformed resolver URL even when not required", () => {
    expect(() =>
      getDatabaseConfig({ DATABASE_URL: POOLED, AUTH_RESOLVER_DATABASE_URL: "mysql://h/db" }),
    ).toThrow(/AUTH_RESOLVER_DATABASE_URL must use the postgres/);
  });

  it("aggregates resolver problems with the rest (all three missing)", () => {
    try {
      getDatabaseConfig({}, { requireDirectUrl: true, requireResolverUrl: true });
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(DatabaseConfigError);
      const problems = (err as DatabaseConfigError).problems;
      expect(problems.some((p) => p.includes("DATABASE_URL is required"))).toBe(true);
      expect(problems.some((p) => p.includes("DIRECT_DATABASE_URL"))).toBe(true);
      expect(problems.some((p) => p.includes("AUTH_RESOLVER_DATABASE_URL"))).toBe(true);
    }
  });
});
