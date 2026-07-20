import { sql } from "drizzle-orm";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";

/**
 * Per-request tenant scoping for RLS (founder directive PHASE 8).
 *
 * Every tenant-scoped request runs its database work inside `withOrgContext`,
 * which opens a transaction and sets `app.current_org_id` **TRANSACTION-LOCAL**
 * (`set_config(..., is_local = true)`). The RLS policies (migration 0003) key
 * off that GUC, so every query is scoped to the one organization — and because
 * the setting is transaction-local it reverts at COMMIT/ROLLBACK. That is the
 * whole point: with connection pooling a SESSION-level setting would leak one
 * request's org into the next request that reuses the connection; a
 * transaction-local one cannot.
 *
 * This is the tenant-scoped path (RLS enforced). Paths that legitimately span
 * organizations — the worker draining the outbox, the AI run consumer — connect
 * under an RLS-bypassing role instead (see the outbox repository docs), and
 * platform-admin cross-tenant access goes through a separate, audited surface.
 * Never widen this helper to skip the org set.
 *
 * DO NOT NEST with a different organization. Exactly one `withOrgContext` per
 * request. Passing the transaction handle into a second `withOrgContext` with a
 * DIFFERENT org opens a savepoint and re-sets the GUC — and because `SET LOCAL`
 * survives savepoint RELEASE, the inner org stays set for the rest of the outer
 * transaction, so later outer queries would read the wrong tenant. (It still
 * reverts at the outer COMMIT, so there is no cross-request leak; same-org
 * nesting is harmless.) A cross-org unit of work must be two separate top-level
 * `withOrgContext` calls.
 *
 * WIRING NOTE: the runtime handle must support interactive transactions —
 * node-postgres `Pool` or `@neondatabase/serverless` WebSocket `Pool`. The
 * `neon-http` driver throws on `.transaction()` (fail-safe, but it would reject
 * every tenant request), so it is unsuitable here.
 */

export type TenantScopedDb = PgDatabase<PgQueryResultHKT>;

/** Thrown when a tenant-scoped request reaches the DB with no resolved organization. */
export class TenantContextError extends Error {
  constructor(public readonly reason: "empty_organization_id") {
    super(`tenant context error: ${reason}`);
    this.name = "TenantContextError";
  }
}

/**
 * Run `work` inside a transaction scoped to `organizationId` via a
 * transaction-local `app.current_org_id`. Fails closed if the organization id is
 * empty (a tenant-scoped request must never reach the DB without a
 * server-resolved org — RLS would deny anyway, but we reject before opening a
 * transaction). The org id comes from the verified session, never the browser.
 */
export async function withOrgContext<T>(
  db: TenantScopedDb,
  organizationId: string,
  work: (tx: TenantScopedDb) => Promise<T>,
): Promise<T> {
  if (organizationId.trim().length === 0) throw new TenantContextError("empty_organization_id");
  return db.transaction(async (tx) => {
    // is_local = true → the setting is scoped to THIS transaction and reverts on
    // COMMIT/ROLLBACK, so a pooled connection never carries it into the next request.
    await tx.execute(sql`SELECT set_config('app.current_org_id', ${organizationId}, true)`);
    return work(tx);
  });
}
