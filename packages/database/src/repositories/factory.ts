import type { FieldCipher } from "@aflo/security";
import type { TenantScopedDb } from "../request-context";
import { DrizzleMessagingRepository } from "./messaging";
import { DrizzleClientUserLinkRepository, DrizzleInvitationRepository } from "./invitation";
import {
  DrizzleIdentityAccountRepository,
  DrizzleSessionRevocationRepository,
  DrizzleWebhookEventRepository,
  type ResolverDb,
} from "./resolver";
import {
  acceptInvitationByToken,
  type AcceptInvitationByTokenInput,
  type AcceptInvitationByTokenOutcome,
} from "../services/accept-invitation";

/**
 * PostgreSQL repository factory (Workstream B — the dependency-injection seam).
 *
 * One composition point builds every Drizzle repository from the two role-scoped
 * handles plus the injected field cipher, so the web app's composition root
 * depends on THIS function — not on individual repository constructors — and
 * tests inject PGlite handles + an ephemeral cipher through the exact same seam
 * the production boot uses (proven in `repository-factory.test.ts`).
 *
 * The split is the ADR-0030/0031 privilege boundary:
 *  - `tenantDb`  (role `aflo_app`)          → org-scoped repos, RLS-enforced via
 *    `withOrgContext` inside each repository.
 *  - `resolverDb` (role `aflo_auth_resolver`) → the un-scoped resolver repos.
 * `acceptInvitation` is pre-bound to BOTH handles (resolver read → org-scoped
 * write), so callers cannot accidentally swap the connections.
 *
 * No connection is opened here — handles are injected, construction is pure.
 */

export interface RepositoryHandles {
  /** Tenant-role handle (`aflo_app`); every org-scoped repo scopes through withOrgContext. */
  tenantDb: TenantScopedDb;
  /** Privileged resolver-role handle (`aflo_auth_resolver`). */
  resolverDb: ResolverDb;
  /** Field cipher for message bodies (ADR-0028); key provenance is the caller's concern. */
  cipher: FieldCipher;
}

export interface Repositories {
  messaging: DrizzleMessagingRepository;
  invitations: DrizzleInvitationRepository;
  clientUserLinks: DrizzleClientUserLinkRepository;
  identityAccounts: DrizzleIdentityAccountRepository;
  webhookEvents: DrizzleWebhookEventRepository;
  sessionRevocations: DrizzleSessionRevocationRepository;
  /** Accept-by-token orchestration (ADR-0032), pre-bound to the two handles. */
  acceptInvitation(input: AcceptInvitationByTokenInput): Promise<AcceptInvitationByTokenOutcome>;
}

export function createRepositories(handles: RepositoryHandles): Repositories {
  const { tenantDb, resolverDb, cipher } = handles;
  return {
    messaging: new DrizzleMessagingRepository(tenantDb, cipher),
    invitations: new DrizzleInvitationRepository(tenantDb),
    clientUserLinks: new DrizzleClientUserLinkRepository(tenantDb),
    identityAccounts: new DrizzleIdentityAccountRepository(resolverDb),
    webhookEvents: new DrizzleWebhookEventRepository(resolverDb),
    sessionRevocations: new DrizzleSessionRevocationRepository(resolverDb),
    acceptInvitation: (input) => acceptInvitationByToken(resolverDb, tenantDb, input),
  };
}
