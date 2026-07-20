import { and, desc, eq } from "drizzle-orm";
import type {
  ClientUserLinkRecord,
  ClientUserLinkRepository,
  Invitation,
  InvitationRepository,
  InvitationStatus,
} from "@aflo/auth";
import { invitations, clientUserLinks } from "../schema";
import { withOrgContext, type TenantScopedDb } from "../request-context";

/**
 * PostgreSQL repositories for the ORG-SCOPED identity tables (migration 0005),
 * behind the @aflo/auth `InvitationRepository` / `ClientUserLinkRepository`
 * contracts. Every op runs inside `withOrgContext` (ADR-0025), so RLS (migration
 * 0005) scopes it to one org on a transaction-local GUC — no cross-request leak.
 *
 * Tokens are DIGEST-ONLY: `invitations.token_digest` stores `Invitation.tokenHash`
 * (sha256 hex), never the raw token — the raw token is not even representable in
 * the domain. The accept-by-token lookup (which reads before an org context
 * exists) is the resolver's privileged `SECURITY DEFINER` path, a separate slice.
 *
 * The handle is driver-agnostic (PGlite in tests, node-postgres/Neon in prod).
 */

/** Thrown when an invitation id is unknown or belongs to another org (RLS-invisible). */
export class InvitationNotFoundError extends Error {
  constructor(public readonly invitationId: string) {
    super(`invitation not found: ${invitationId}`);
    this.name = "InvitationNotFoundError";
  }
}

/** Thrown when a client (or user) already holds an active link (partial-unique violation). */
export class ClientAlreadyLinkedError extends Error {
  constructor(public readonly detail: string) {
    super(`client/user already has an active link: ${detail}`);
    this.name = "ClientAlreadyLinkedError";
  }
}

/** Thrown when revoking a link id that is unknown or in another org. */
export class ClientLinkNotFoundError extends Error {
  constructor(public readonly linkId: string) {
    super(`client-user link not found: ${linkId}`);
    this.name = "ClientLinkNotFoundError";
  }
}

/**
 * Postgres unique-violation (SQLSTATE 23505) detector. Drizzle wraps the driver
 * error in a `Failed query: …` Error and attaches the original (which carries
 * `code`/constraint detail) as `.cause`, so inspect BOTH the error and its cause,
 * by code and by message (node-postgres and PGlite differ in shape).
 */
function isUniqueViolation(err: unknown): boolean {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (!candidate) continue;
    if ((candidate as { code?: string }).code === "23505") return true;
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    if (/duplicate key|unique constraint|23505/i.test(message)) return true;
  }
  return false;
}

type InvitationRow = typeof invitations.$inferSelect;
type LinkRow = typeof clientUserLinks.$inferSelect;

function isoOrNull(value: Date | null): string | null {
  return value === null ? null : value.toISOString();
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organizationId,
    email: row.email,
    intendedRole: row.intendedRole,
    reservedClientId: row.intendedClientId,
    tokenHash: row.tokenDigest,
    status: row.status as InvitationStatus,
    createdAtIso: row.createdAt.toISOString(),
    expiresAtIso: row.expiresAt.toISOString(),
    acceptedByAfloUserId: row.acceptedByUserId,
    acceptedAtIso: isoOrNull(row.acceptedAt),
  };
}

function toLink(row: LinkRow): ClientUserLinkRecord {
  return {
    id: row.id,
    organizationId: row.organizationId,
    clientId: row.clientId,
    userId: row.userId,
    status: row.status as "active" | "revoked",
    linkedAtIso: row.linkedAt.toISOString(),
    revokedAtIso: isoOrNull(row.revokedAt),
  };
}

export class DrizzleInvitationRepository implements InvitationRepository {
  constructor(private readonly db: TenantScopedDb) {}

  async issue(
    organizationId: string,
    invitation: Invitation,
    createdByMemberId: string | null,
    now: Date,
  ): Promise<Invitation> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const inserted = await tx
        .insert(invitations)
        .values({
          id: invitation.id,
          organizationId,
          email: invitation.email,
          // Derived from the invited role: only a `client` invitation onboards a client.
          invitationType: invitation.intendedRole === "client" ? "client" : "staff",
          // issueInvitation guarantees an invitable role (the 4-member enum).
          intendedRole: invitation.intendedRole as InvitationRow["intendedRole"],
          intendedClientId: invitation.reservedClientId,
          tokenDigest: invitation.tokenHash,
          status: "pending",
          expiresAt: new Date(invitation.expiresAtIso),
          createdByMemberId,
          createdAt: new Date(invitation.createdAtIso),
          updatedAt: now,
        })
        .returning();
      return toInvitation(inserted[0]!);
    });
  }

  async getById(organizationId: string, invitationId: string): Promise<Invitation | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx.select().from(invitations).where(eq(invitations.id, invitationId)).limit(1);
      return rows[0] ? toInvitation(rows[0]) : null;
    });
  }

  async listByOrg(organizationId: string, status?: InvitationStatus): Promise<Invitation[]> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(invitations)
        .where(status ? eq(invitations.status, status) : undefined)
        .orderBy(desc(invitations.createdAt));
      return rows.map(toInvitation);
    });
  }

  async save(organizationId: string, invitation: Invitation, now: Date): Promise<Invitation> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const set: Partial<typeof invitations.$inferInsert> = {
        status: invitation.status,
        acceptedByUserId: invitation.acceptedByAfloUserId,
        acceptedAt: invitation.acceptedAtIso === null ? null : new Date(invitation.acceptedAtIso),
        updatedAt: now,
      };
      // The domain has no revoked-at field; stamp it here when the transition is a revoke.
      if (invitation.status === "revoked") set.revokedAt = now;
      const updated = await tx
        .update(invitations)
        .set(set)
        .where(eq(invitations.id, invitation.id))
        .returning();
      if (!updated[0]) throw new InvitationNotFoundError(invitation.id);
      return toInvitation(updated[0]);
    });
  }
}

export class DrizzleClientUserLinkRepository implements ClientUserLinkRepository {
  constructor(private readonly db: TenantScopedDb) {}

  async link(
    organizationId: string,
    clientId: string,
    userId: string,
    now: Date,
  ): Promise<ClientUserLinkRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      try {
        const inserted = await tx
          .insert(clientUserLinks)
          .values({
            organizationId,
            clientId,
            userId,
            status: "active",
            linkedAt: now,
            createdAt: now,
            updatedAt: now,
          })
          .returning();
        return toLink(inserted[0]!);
      } catch (err) {
        // A client already claimed, or a user already linked to another client
        // (the two partial-unique-on-active indexes) — surface a domain error.
        if (isUniqueViolation(err)) throw new ClientAlreadyLinkedError(`client=${clientId} user=${userId}`);
        throw err;
      }
    });
  }

  async getActiveByClient(organizationId: string, clientId: string): Promise<ClientUserLinkRecord | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(clientUserLinks)
        .where(and(eq(clientUserLinks.clientId, clientId), eq(clientUserLinks.status, "active")))
        .limit(1);
      return rows[0] ? toLink(rows[0]) : null;
    });
  }

  async getActiveByUser(organizationId: string, userId: string): Promise<ClientUserLinkRecord | null> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const rows = await tx
        .select()
        .from(clientUserLinks)
        .where(and(eq(clientUserLinks.userId, userId), eq(clientUserLinks.status, "active")))
        .limit(1);
      return rows[0] ? toLink(rows[0]) : null;
    });
  }

  async revoke(organizationId: string, linkId: string, now: Date): Promise<ClientUserLinkRecord> {
    return withOrgContext(this.db, organizationId, async (tx) => {
      const updated = await tx
        .update(clientUserLinks)
        .set({ status: "revoked", revokedAt: now, updatedAt: now })
        .where(eq(clientUserLinks.id, linkId))
        .returning();
      if (!updated[0]) throw new ClientLinkNotFoundError(linkId);
      return toLink(updated[0]);
    });
  }
}
