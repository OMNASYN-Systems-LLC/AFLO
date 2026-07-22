/**
 * Provider-backed session-context adapter (Production Cutover, Workstream B3).
 *
 * The credential-free core of "a real Clerk session becomes a SessionContext".
 * Everything the identity provider's SDK would supply is INJECTED behind two
 * ports, so the adapter is fully built and tested without Clerk credentials —
 * activating it later is composition, not new logic:
 *
 *   - `ProviderSessionSource` — yields the CURRENT request's VERIFIED provider
 *     session (Clerk's `auth()` in the Next.js composition root; a stub in
 *     tests). The adapter never verifies tokens itself and never reads env.
 *   - `PrincipalDirectory` — loads the ΛFLO-side principal records (users row,
 *     staff membership, client link) for a provider identity. The Drizzle
 *     implementation runs on the RESOLVER connection (these reads happen BEFORE
 *     any org context exists — the org is discovered FROM the membership/link).
 *
 * Resolution is fail-closed at every step: no verified session, malformed
 * session fields, an unmapped provider identity, a directory/identity mismatch,
 * or a revoked session each resolve to NULL (unauthenticated) — never a guess.
 * Role/tenant derivation stays in the deterministic `buildSessionContext`
 * (disabled-account gate, revocation cutoff, role precedence); this adapter
 * adds no authority of its own. Providers are identity authorities ONLY — the
 * browser never supplies org, role, client, or issued-at.
 *
 * CREDENTIAL-GATED WIRING (composition root, later):
 *
 *   const source: ProviderSessionSource = {
 *     async current() {
 *       const { userId, sessionId, sessionClaims } = await auth(); // @clerk/nextjs/server
 *       if (!userId || !sessionId || typeof sessionClaims?.iat !== "number") return null;
 *       return {
 *         provider: "clerk",
 *         providerUserId: userId,
 *         providerSessionId: sessionId,
 *         issuedAtIso: new Date(sessionClaims.iat * 1000).toISOString(),
 *       };
 *     },
 *   };
 */

import type { AfloIdentity, ClientLink, Membership } from "./identity";
import type { IdentityProvider } from "./resolver-repositories";
import {
  buildSessionContext,
  type SessionContext,
  type SessionContextProvider,
} from "./session-context";

/**
 * The VERIFIED facts of the current provider session. Every field comes from
 * the provider's server-side verification (Clerk `auth()`), never the browser.
 */
export interface VerifiedProviderSession {
  provider: IdentityProvider;
  /** The provider's user id (Clerk user id) — the identity-mapping key. */
  providerUserId: string;
  /**
   * The provider's session id. Carried RAW in memory for the revocation gate
   * (which digests it); it is never persisted raw (ADR-0026: digests only).
   */
  providerSessionId: string;
  /** When the session was issued — checked against the revocation cutoff. */
  issuedAtIso: string;
}

/** Server-only port yielding the current request's verified provider session. */
export interface ProviderSessionSource {
  /** Null = no verified session on this request (unauthenticated). */
  current(): Promise<VerifiedProviderSession | null>;
}

/** Everything `buildSessionContext` needs for one resolved ΛFLO user. */
export interface PrincipalRecords {
  identity: AfloIdentity;
  /** The user's ACTIVE staff membership, if any. */
  membership: Membership | null;
  /** The user's ACTIVE client link, if any. */
  clientLink: ClientLink | null;
  /** Staff assignment scoping (null = scoping off — staff see all, §8). */
  assignedClientIds: readonly string[] | null;
}

/**
 * Loads the ΛFLO principal records for a provider identity: the
 * `identity_provider_accounts` mapping → the `users` row (account status,
 * platform flag, revocation cutoff) → membership/client link. Returns null when
 * the provider identity maps to no ΛFLO user (fail closed — an authenticated
 * stranger is still unauthenticated to ΛFLO until an invitation binds them).
 */
export interface PrincipalDirectory {
  loadByProviderUser(
    provider: IdentityProvider,
    providerUserId: string,
  ): Promise<PrincipalRecords | null>;
}

/**
 * Optional digest-specific revocation check over `session_revocations`
 * (ADR-0030). `buildSessionContext` already enforces the users-row cutoff
 * (revoke-ALL / disable); this gate adds per-session ("sign out THIS device")
 * revocation. Implementations digest the raw provider session id server-side
 * and query USER-scoped — the raw id is never stored.
 */
export interface SessionRevocationGate {
  isRevoked(
    afloUserId: string,
    providerSessionId: string,
    sessionIssuedAtIso: string,
  ): Promise<boolean>;
}

function isNonEmpty(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isParsableIso(value: unknown): value is string {
  return typeof value === "string" && !Number.isNaN(Date.parse(value));
}

/**
 * The provider-backed `SessionContextProvider`: verified provider session →
 * principal records → deterministic `buildSessionContext`. Fail-closed; adds no
 * authority beyond composing the injected ports.
 */
export class ProviderSessionContextProvider implements SessionContextProvider {
  private readonly source: ProviderSessionSource;
  private readonly directory: PrincipalDirectory;
  private readonly revocationGate: SessionRevocationGate | null;

  constructor(options: {
    source: ProviderSessionSource;
    directory: PrincipalDirectory;
    /** Omit only where digest-specific revocation is enforced elsewhere. */
    revocationGate?: SessionRevocationGate | null;
  }) {
    this.source = options.source;
    this.directory = options.directory;
    this.revocationGate = options.revocationGate ?? null;
  }

  async resolve(): Promise<SessionContext | null> {
    // 1. A verified provider session, or nothing.
    const session = await this.source.current();
    if (!session) return null;

    // 2. Malformed session facts never reach the directory (fail closed).
    if (
      !isNonEmpty(session.providerUserId) ||
      !isNonEmpty(session.providerSessionId) ||
      !isParsableIso(session.issuedAtIso)
    ) {
      return null;
    }

    // 3. Map the provider identity to ΛFLO's own records. Unmapped = null:
    //    authentication alone grants nothing until an invitation binds the
    //    identity (the identity-claiming invariant, ADR-0022).
    const records = await this.directory.loadByProviderUser(session.provider, session.providerUserId);
    if (!records) return null;

    // 4. Defense in depth: the directory's identity must be the mapping for
    //    THIS provider user — a mismatched row is a wiring bug, resolved as
    //    unauthenticated rather than as someone else.
    if (records.identity.clerkUserId !== session.providerUserId) return null;

    // 5. Digest-specific revocation ("sign out this device"), when wired.
    //    Errors propagate — a failing revocation store must not fail OPEN.
    if (this.revocationGate) {
      const revoked = await this.revocationGate.isRevoked(
        records.identity.afloUserId,
        session.providerSessionId,
        session.issuedAtIso,
      );
      if (revoked) return null;
    }

    // 6. Deterministic derivation: disabled-account gate, revoke-all cutoff,
    //    role precedence (platform flag → membership → client link).
    return buildSessionContext({
      sessionId: session.providerSessionId,
      identity: records.identity,
      membership: records.membership,
      clientLink: records.clientLink,
      assignedClientIds: records.assignedClientIds,
      sessionIssuedAtIso: session.issuedAtIso,
    });
  }
}
