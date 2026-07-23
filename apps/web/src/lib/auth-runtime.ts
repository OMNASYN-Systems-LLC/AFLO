import { createHash } from "node:crypto";
import {
  ProviderSessionContextProvider,
  type ProviderSessionSource,
  type SessionContext,
  type SessionContextProvider,
} from "@aflo/auth";
import {
  createResolverConnection,
  createTenantConnection,
  DrizzlePrincipalDirectory,
  DrizzleSessionRevocationRepository,
  type ConnectionHandle,
  type ResolverDb,
} from "@aflo/database";

/**
 * SERVER-ONLY auth-runtime composition helpers for API routes (Workstream
 * B6/B7, ADR-0042). Imported only from `app/api/**` route handlers pinned to
 * `runtime = "nodejs"` — never from client components (node:crypto + pg).
 *
 * Two things live here, both extracted from the B4 webhook-route pattern
 * (ADR-0039) so the invitation routes don't re-implement them:
 *
 *  1. Module-scoped LAZY connection caches for the two role-scoped pools. Pool
 *     construction performs no I/O (ADR-0033) and a per-request pool would
 *     leak — one handle serves the route's lifetime, keyed by URL so a config
 *     change in dev drains the replaced handle instead of leaking it.
 *
 *  2. The provider-backed session seam. `clerkSessionSource()` is the ONLY
 *     credential-gated point: today it yields no session (no Clerk SDK
 *     composed), so every session-gated route answers 401 — fail closed, no
 *     stub identities. ACTIVATION IS COMPOSITION, NOT NEW LOGIC: replace the
 *     body with the Clerk `auth()` closure documented in
 *     `@aflo/auth/provider-session.ts` (and bind `verifiedSessionEmail` to the
 *     verified Clerk primary email); everything downstream — principal
 *     directory, revocation gate, deterministic session build — is already
 *     wired and tested.
 */

/** One cached handle per factory, keyed by URL; a replaced handle is drained. */
function lazyHandle<Db>(
  create: (url: string) => ConnectionHandle<Db>,
): (url: string) => ConnectionHandle<Db> {
  let cached: { url: string; handle: ConnectionHandle<Db> } | null = null;
  return (url: string) => {
    if (!cached || cached.url !== url) {
      void cached?.handle.close().catch(() => undefined);
      cached = { url, handle: create(url) };
    }
    return cached.handle;
  };
}

/** The tenant-role pool (`DATABASE_URL`, role aflo_app — RLS-scoped via withOrgContext). */
export const tenantHandle = lazyHandle(createTenantConnection);

/** The resolver-role pool (`AUTH_RESOLVER_DATABASE_URL`, role aflo_auth_resolver). */
export const resolverHandle = lazyHandle(createResolverConnection);

/**
 * CREDENTIAL-GATED: the current request's verified Clerk session. Until the
 * Clerk closure is composed (see module doc), there is no verified provider
 * session — routes composed over this fail closed with 401.
 */
export function clerkSessionSource(): ProviderSessionSource {
  return { current: async () => null };
}

/**
 * The provider-backed SessionContextProvider for one request: verified Clerk
 * session → Drizzle principal directory (resolver connection — these reads
 * precede any org context) → digest-specific revocation gate (ADR-0026:
 * the raw provider session id is digested here, never persisted raw) →
 * deterministic `buildSessionContext`.
 */
export function createSessionProvider(resolverDb: ResolverDb): SessionContextProvider {
  const revocations = new DrizzleSessionRevocationRepository(resolverDb);
  return new ProviderSessionContextProvider({
    source: clerkSessionSource(),
    directory: new DrizzlePrincipalDirectory(resolverDb),
    revocationGate: {
      isRevoked: (afloUserId, providerSessionId, sessionIssuedAtIso) =>
        revocations.isSessionRevoked(
          afloUserId,
          new Date(sessionIssuedAtIso),
          createHash("sha256").update(providerSessionId, "utf8").digest("hex"),
          new Date(),
        ),
    },
  });
}

/**
 * CREDENTIAL-GATED: the accepter's VERIFIED email for the invitation-accept
 * flow — sourced from the verified Clerk session identity (provider-verified
 * primary email), NEVER the request body. Until the Clerk closure is composed
 * this yields null and the accept route fails closed (401 `no_verified_email`
 * — unreachable today anyway, since `clerkSessionSource` resolves no session).
 */
export async function verifiedSessionEmail(ctx: SessionContext): Promise<string | null> {
  void ctx; // consumed by the Clerk closure at activation
  return null;
}
