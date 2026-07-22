import { Pool } from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import type { TenantScopedDb } from "./request-context";
import type { ResolverDb } from "./repositories/resolver";
import { getDatabaseConfig, type DatabaseConfig } from "./config";

/**
 * Connection factories for the authenticated runtime (Workstream B, founder
 * continuation directive 2026-07-22) — the two role-scoped pools the cutover
 * runbook specifies:
 *
 *  - TENANT connection (`DATABASE_URL`, role `aflo_app`, NON-BYPASSRLS): every
 *    request runs through `withOrgContext`, so RLS scopes it to one org.
 *  - RESOLVER connection (`AUTH_RESOLVER_DATABASE_URL`, role
 *    `aflo_auth_resolver`, BYPASSRLS — ADR-0030/0031): identity resolution,
 *    webhook receipts, session-revocation checks, accept-by-token resolve.
 *
 * The driver is node-postgres (`pg.Pool`) — an INTERACTIVE-TRANSACTION driver,
 * which `withOrgContext` requires (`neon-http` throws on `.transaction()` and
 * would reject every tenant request). Neon's pooled `-pooler` endpoints speak
 * the Postgres wire protocol, so `pg` connects to them directly.
 *
 * Pools are LAZY: constructing one performs no I/O — the first query opens the
 * first socket. That property is what makes these factories fully testable
 * credential-free (proven in `connection.test.ts`), and means module-level
 * construction cannot crash a boot on a slow network; a bad URL surfaces on
 * first use, and the fail-closed CONFIG validation (`getDatabaseConfig`)
 * catches malformed environments before a pool is ever built.
 */

export interface PoolOptions {
  /** Max clients in the pool (default 10 — Neon pooled endpoints multiplex behind PgBouncer). */
  max?: number;
  /** Milliseconds an idle client is kept before being closed (default 30s). */
  idleTimeoutMillis?: number;
  /** Milliseconds to wait for a connection before failing a query (default 10s, fail-closed). */
  connectionTimeoutMillis?: number;
}

/** A live drizzle handle plus its pool and a clean shutdown. */
export interface ConnectionHandle<Db> {
  db: Db;
  pool: Pool;
  /** Drain and close every client. Idempotent-safe to call once at shutdown. */
  close(): Promise<void>;
}

function buildPool(connectionString: string, opts: PoolOptions): Pool {
  return new Pool({
    connectionString,
    max: opts.max ?? 10,
    idleTimeoutMillis: opts.idleTimeoutMillis ?? 30_000,
    connectionTimeoutMillis: opts.connectionTimeoutMillis ?? 10_000,
  });
}

function toHandle<Db>(pool: Pool, db: Db): ConnectionHandle<Db> {
  return { db, pool, close: () => pool.end() };
}

/**
 * The tenant-role connection (`aflo_app`). Callers route every query through
 * `withOrgContext(handle.db, orgId, …)`; nothing here widens that contract.
 */
export function createTenantConnection(url: string, opts: PoolOptions = {}): ConnectionHandle<TenantScopedDb> {
  const pool = buildPool(url, opts);
  return toHandle(pool, drizzle(pool) as unknown as TenantScopedDb);
}

/**
 * The privileged resolver-role connection (`aflo_auth_resolver`). Used ONLY by
 * the resolver-path repositories (ADR-0031) and the accept-by-token resolve —
 * never for tenant request work.
 */
export function createResolverConnection(url: string, opts: PoolOptions = {}): ConnectionHandle<ResolverDb> {
  const pool = buildPool(url, opts);
  return toHandle(pool, drizzle(pool) as unknown as ResolverDb);
}

/** Both runtime connections, built from a validated config. */
export interface RuntimeConnections {
  tenant: ConnectionHandle<TenantScopedDb>;
  resolver: ConnectionHandle<ResolverDb>;
  /** Close both pools (shutdown hook). */
  close(): Promise<void>;
}

/**
 * Build BOTH runtime connections from the environment, fail-closed: a missing
 * or malformed `DATABASE_URL` / `AUTH_RESOLVER_DATABASE_URL` throws
 * `DatabaseConfigError` (aggregated) BEFORE any pool exists. No I/O happens
 * here — pools are lazy — so this is safe to call at boot and fully testable
 * without a live server.
 */
export function createRuntimeConnections(
  env: Record<string, string | undefined> = process.env,
  opts: PoolOptions = {},
): RuntimeConnections {
  const config: DatabaseConfig = getDatabaseConfig(env, { requireResolverUrl: true });
  const tenant = createTenantConnection(config.url, opts);
  const resolver = createResolverConnection(config.resolverUrl!, opts);
  return {
    tenant,
    resolver,
    close: async () => {
      await Promise.all([tenant.close(), resolver.close()]);
    },
  };
}
