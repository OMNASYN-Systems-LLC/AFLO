import { describe, expect, it } from "vitest";
import { DatabaseConfigError } from "../src/config";
import {
  createResolverConnection,
  createRuntimeConnections,
  createTenantConnection,
} from "../src/connection";

/**
 * The connection factories must be provable credential-free, which rests on one
 * driver property: pg.Pool is LAZY — construction performs no I/O. These tests
 * prove (1) building either handle against an unreachable host neither connects
 * nor throws, (2) close() resolves cleanly on a never-used pool, (3) the drizzle
 * handles expose the interactive-transaction API withOrgContext requires, and
 * (4) createRuntimeConnections fails CLOSED on bad config BEFORE any pool
 * exists. No test here ever opens a socket.
 */

// Guaranteed-unreachable (TEST-NET-1) — nothing may ever connect to it.
const FAKE_TENANT = "postgresql://aflo_app:x@192.0.2.1:5432/aflo";
const FAKE_RESOLVER = "postgresql://aflo_auth_resolver:x@192.0.2.1:5432/aflo";

describe("connection factories (lazy, credential-free)", () => {
  it("constructs a tenant handle without connecting, and closes cleanly", async () => {
    const handle = createTenantConnection(FAKE_TENANT, { connectionTimeoutMillis: 50 });
    expect(handle.pool.totalCount).toBe(0); // no client was ever created
    // The drizzle handle exposes the interactive-transaction API withOrgContext needs.
    expect(typeof handle.db.transaction).toBe("function");
    await handle.close();
  });

  it("constructs a resolver handle without connecting, and closes cleanly", async () => {
    const handle = createResolverConnection(FAKE_RESOLVER);
    expect(handle.pool.totalCount).toBe(0);
    expect(typeof handle.db.select).toBe("function");
    await handle.close();
  });

  it("builds both runtime connections from a valid env without any I/O", async () => {
    const runtime = createRuntimeConnections({
      DATABASE_URL: FAKE_TENANT,
      AUTH_RESOLVER_DATABASE_URL: FAKE_RESOLVER,
    });
    expect(runtime.tenant.pool.totalCount).toBe(0);
    expect(runtime.resolver.pool.totalCount).toBe(0);
    await runtime.close();
  });

  it("fails closed on a missing resolver URL — before any pool exists", () => {
    expect(() => createRuntimeConnections({ DATABASE_URL: FAKE_TENANT })).toThrow(DatabaseConfigError);
    expect(() => createRuntimeConnections({ DATABASE_URL: FAKE_TENANT })).toThrow(
      /AUTH_RESOLVER_DATABASE_URL is required/,
    );
  });

  it("fails closed on a malformed tenant URL", () => {
    expect(() =>
      createRuntimeConnections({ DATABASE_URL: "mysql://nope/db", AUTH_RESOLVER_DATABASE_URL: FAKE_RESOLVER }),
    ).toThrow(DatabaseConfigError);
  });
});
