/**
 * Minimal database handle the acceptance checks run over (ADR-0050).
 *
 * The suite must execute unchanged against PGlite (CI, credential-free) and a
 * remote node-postgres Pool (Neon preview, env-gated), so checks depend only on
 * this structural interface — never on a concrete driver. `withSession` exists
 * because the fail-closed smoke needs BEGIN/…/ROLLBACK on ONE connection: a
 * pool-level `query` may hop clients between statements, silently breaking the
 * transaction. PGlite is a single session, so it returns itself.
 */

export interface QueryResultLike<R> {
  rows: R[];
}

export interface AcceptanceDb {
  query<R = Record<string, unknown>>(text: string, params?: unknown[]): Promise<QueryResultLike<R>>;
  /** Run `work` with a handle whose queries are guaranteed to share one connection. */
  withSession<T>(work: (session: AcceptanceDb) => Promise<T>): Promise<T>;
}

/** Structural PGlite surface (kept structural so this module never imports the dev-only driver). */
export interface PGliteLike {
  query<R>(query: string, params?: unknown[]): Promise<{ rows: R[] }>;
}

/** Structural node-postgres Pool surface. */
export interface PgPoolLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  connect(): Promise<PgPoolClientLike>;
}

export interface PgPoolClientLike {
  query(text: string, values?: unknown[]): Promise<{ rows: unknown[] }>;
  release(): void;
}

/** Adapt a PGlite instance. PGlite is one session, so `withSession` reuses the same handle. */
export function acceptanceDbFromPGlite(pglite: PGliteLike): AcceptanceDb {
  const handle: AcceptanceDb = {
    query: async <R>(text: string, params?: unknown[]) => {
      const res = await pglite.query<R>(text, params);
      return { rows: res.rows };
    },
    withSession: async (work) => work(handle),
  };
  return handle;
}

/** Adapt a node-postgres Pool. `withSession` pins one checked-out client. */
export function acceptanceDbFromPgPool(pool: PgPoolLike): AcceptanceDb {
  const fromClient = (client: PgPoolClientLike): AcceptanceDb => {
    const session: AcceptanceDb = {
      query: async <R>(text: string, params?: unknown[]) => {
        const res = await client.query(text, params);
        return { rows: res.rows as R[] };
      },
      withSession: async (work) => work(session),
    };
    return session;
  };
  return {
    query: async <R>(text: string, params?: unknown[]) => {
      const res = await pool.query(text, params);
      return { rows: res.rows as R[] };
    },
    withSession: async (work) => {
      const client = await pool.connect();
      try {
        return await work(fromClient(client));
      } finally {
        client.release();
      }
    },
  };
}
