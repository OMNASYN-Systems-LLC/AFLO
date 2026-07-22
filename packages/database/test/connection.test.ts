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

  it("close() is idempotent — a second call resolves instead of rejecting", async () => {
    const handle = createTenantConnection(FAKE_TENANT);
    await handle.close();
    await expect(handle.close()).resolves.toBeUndefined(); // pg.Pool alone would reject here
  });

  it("BRANDS the handles: swapping tenant and resolver connections cannot typecheck", () => {
    // Compile-time proof (validated by `tsc --noEmit`: an unused @ts-expect-error
    // is itself an error, so if a swap ever became assignable this test file
    // stops typechecking). The function is deliberately never executed.
    const compileOnlyProof = (): void => {
      const tenant = createTenantConnection(FAKE_TENANT);
      const resolver = createResolverConnection(FAKE_RESOLVER);
      // @ts-expect-error a branded resolver handle must not be usable as the tenant handle
      const wrongTenant: typeof tenant.db = resolver.db;
      // @ts-expect-error a branded tenant handle must not be usable as the resolver handle
      const wrongResolver: typeof resolver.db = tenant.db;
      void wrongTenant;
      void wrongResolver;
    };
    expect(typeof compileOnlyProof).toBe("function");
  });
});
