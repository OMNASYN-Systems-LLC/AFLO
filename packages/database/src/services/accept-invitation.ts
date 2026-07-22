import { and, eq, sql } from "drizzle-orm";
import {
  acceptInvitation,
  applyAcceptedBinding,
  type Invitation,
  type InvitationDenial,
  type InvitationStatus,
  type MembershipDenial,
  type Role,
} from "@aflo/auth";
import { hashInvitationToken, verifyInvitationToken } from "@aflo/auth/invitation-token";
import { invitations, clientUserLinks, organizationMembers } from "../schema";
import { withOrgContext, type TenantScopedDb } from "../request-context";
import type { ResolverDb } from "../repositories/resolver";

/**
 * Accept-by-token orchestration (Production Cutover — the capstone that ties the
 * resolver read to the org-scoped write).
 *
 * A client/staff invitee presents the raw token from their invite link. This:
 *   1. Resolves the invitation across orgs with NO org context, via the
 *      `find_invitation_by_token` SECURITY DEFINER function (migration 0007) on
 *      the RESOLVER connection — `invitations` is FORCE-RLS, so a plain pre-org
 *      read would see nothing.
 *   2. Constant-time-verifies the presented raw token against the stored digest.
 *   3. Runs the deterministic kernel: `acceptInvitation` (email/expiry/status +
 *      the identity-claiming invariant — org/client come from the invitation,
 *      never the caller) → `applyAcceptedBinding` (membership vs client link).
 *   4. In ONE `withOrgContext(resolvedOrg)` transaction: atomically CLAIMS the
 *      invitation (conditional `status='pending'` update — guards a concurrent
 *      double-accept) and creates the `client_user_link` (client) or
 *      `organization_members` row (staff). Both commit together or roll back.
 *
 * The org is discovered from the invitation, so the write is correctly tenant-
 * scoped even though the resolve preceded any org context.
 */

export interface AcceptInvitationByTokenInput {
  /** The raw token from the invite link (never stored; hashed here). */
  rawToken: string;
  /** The authenticated ΛFLO user accepting (resolved from the verified identity). */
  afloUserId: string;
  /** The accepting identity's VERIFIED email (from the IdP) — must match the invitation. */
  email: string;
  /** Server clock. */
  now: Date;
  /** Server-issued id for a new staff membership (unused for a client link). */
  newMembershipId: string;
}

export type AcceptInvitationByTokenOutcome =
  | { ok: true; kind: "membership"; organizationId: string; membershipId: string }
  | { ok: true; kind: "client_link"; organizationId: string; clientId: string; linkId: string }
  | { ok: false; reason: "invalid_token" | "already_bound" | InvitationDenial | MembershipDenial };

/** Raw row shape from `SELECT * FROM find_invitation_by_token(...)`. */
interface InvitationRow {
  id: string;
  organization_id: string;
  email: string;
  intended_role: string;
  intended_client_id: string | null;
  token_digest: string;
  status: string;
  created_at: string | Date;
  expires_at: string | Date;
  accepted_at: string | Date | null;
  accepted_by_user_id: string | null;
}

function toIso(value: string | Date): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function toInvitation(row: InvitationRow): Invitation {
  return {
    id: row.id,
    organizationId: row.organization_id,
    email: row.email,
    intendedRole: row.intended_role as Role,
    reservedClientId: row.intended_client_id,
    tokenHash: row.token_digest,
    status: row.status as InvitationStatus,
    createdAtIso: toIso(row.created_at),
    expiresAtIso: toIso(row.expires_at),
    acceptedByAfloUserId: row.accepted_by_user_id,
    acceptedAtIso: row.accepted_at === null ? null : toIso(row.accepted_at),
  };
}

/** Thrown inside the accept transaction to roll it back on a concurrent double-accept. */
class InvitationClaimConflict extends Error {
  constructor() {
    super("invitation is no longer pending");
    this.name = "InvitationClaimConflict";
  }
}

/**
 * Thrown inside the accept transaction (rolling it back, so the invitation stays
 * pending) when the link/membership insert hits a unique constraint — the
 * accepter already holds an active link for the reserved client, or is already a
 * member of the org.
 */
class AlreadyBoundError extends Error {
  constructor() {
    super("identity is already bound to this org/client");
    this.name = "AlreadyBoundError";
  }
}

/** Postgres unique-violation (23505), inspecting the drizzle wrapper and its `.cause`. */
function isUniqueViolation(err: unknown): boolean {
  for (const candidate of [err, (err as { cause?: unknown } | null)?.cause]) {
    if (!candidate) continue;
    if ((candidate as { code?: string }).code === "23505") return true;
    const message = candidate instanceof Error ? candidate.message : String(candidate);
    if (/duplicate key|unique constraint|23505/i.test(message)) return true;
  }
  return false;
}

export async function acceptInvitationByToken(
  resolverDb: ResolverDb,
  tenantDb: TenantScopedDb,
  input: AcceptInvitationByTokenInput,
): Promise<AcceptInvitationByTokenOutcome> {
  const nowIso = input.now.toISOString();
  const tokenHash = hashInvitationToken(input.rawToken);

  // 1. Resolve across orgs with NO org context (SECURITY DEFINER, resolver conn).
  const resolved = (await resolverDb.execute(
    sql`SELECT id, organization_id, email, intended_role, intended_client_id, token_digest, status, created_at, expires_at, accepted_at, accepted_by_user_id
        FROM find_invitation_by_token(${tokenHash})`,
  )) as unknown as { rows: InvitationRow[] };
  const row = resolved.rows[0];
  if (!row) return { ok: false, reason: "invalid_token" };

  // 2. Constant-time verify the presented raw token against the stored digest.
  if (!verifyInvitationToken(input.rawToken, row.token_digest)) return { ok: false, reason: "invalid_token" };

  const invitation = toInvitation(row);

  // 3. Deterministic kernel: accept + bind. The binding's org/role/client come
  //    from the invitation, never the caller (identity-claiming invariant).
  const accepted = acceptInvitation(invitation, {
    afloUserId: input.afloUserId,
    email: input.email,
    nowIso,
  });
  if (!accepted.ok) return { ok: false, reason: accepted.reason };
  const binding = accepted.binding!;

  const application = applyAcceptedBinding(binding, { membershipId: input.newMembershipId, nowIso });
  if (application.kind === "rejected") return { ok: false, reason: application.reason };

  // 4. Atomically claim the invitation + create the link/membership, org-scoped.
  try {
    return await withOrgContext(tenantDb, binding.organizationId, async (tx) => {
      // Claim FIRST, conditional on still-pending — a concurrent accept that won
      // the race leaves 0 rows, so we abort (rolling back any write below).
      const claimed = await tx
        .update(invitations)
        .set({
          status: "accepted",
          acceptedByUserId: input.afloUserId,
          acceptedAt: input.now,
          updatedAt: input.now,
        })
        .where(and(eq(invitations.id, invitation.id), eq(invitations.status, "pending")))
        .returning({ id: invitations.id });
      if (!claimed[0]) throw new InvitationClaimConflict();

      try {
        if (application.kind === "client_link") {
          const link = await tx
            .insert(clientUserLinks)
            .values({
              organizationId: binding.organizationId,
              clientId: application.clientLink.clientId,
              userId: input.afloUserId,
              status: "active",
              linkedAt: input.now,
              createdAt: input.now,
              updatedAt: input.now,
            })
            .returning({ id: clientUserLinks.id });
          return {
            ok: true as const,
            kind: "client_link" as const,
            organizationId: binding.organizationId,
            clientId: application.clientLink.clientId,
            linkId: link[0]!.id,
          };
        }

        const member = await tx
          .insert(organizationMembers)
          .values({
            id: application.membership.membershipId,
            organizationId: binding.organizationId,
            userId: input.afloUserId,
            role: application.membership.memberRole,
            isActive: true,
            createdAt: input.now,
            updatedAt: input.now,
          })
          .returning({ id: organizationMembers.id });
        return {
          ok: true as const,
          kind: "membership" as const,
          organizationId: binding.organizationId,
          membershipId: member[0]!.id,
        };
      } catch (insertErr) {
        // An active-link / membership uniqueness violation → roll back the claim
        // too (the invitation stays pending) and surface a typed denial.
        if (isUniqueViolation(insertErr)) throw new AlreadyBoundError();
        throw insertErr;
      }
    });
  } catch (err) {
    if (err instanceof InvitationClaimConflict) return { ok: false, reason: "already_accepted" };
    if (err instanceof AlreadyBoundError) return { ok: false, reason: "already_bound" };
    throw err;
  }
}
