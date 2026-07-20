/**
 * Persistence contracts for the ORG-SCOPED identity tables (migration 0005):
 * `invitations` and `client_user_links`. Both carry `organization_id` and are
 * RLS-forced, so their Neon-backed implementations run under `withOrgContext`
 * and every query is scoped to one organization.
 *
 * These cover the org-scoped operations a staff/owner performs: issuing,
 * listing, and revoking invitations, and reading/revoking a client's user link.
 * The ACCEPT-by-token path (a client claiming an invitation) reads the
 * invitation BEFORE an org context exists, so it is the auth resolver's
 * privileged path (a `SECURITY DEFINER` lookup) — a separate slice, not modeled
 * here. Tokens are stored as digests only (`Invitation.tokenHash`), never raw.
 */

import type { Invitation, InvitationStatus } from "./invitation";

export interface InvitationRepository {
  /**
   * Persist a freshly-issued PENDING invitation (built by `issueInvitation`).
   * The raw token is never passed here — only its digest (`invitation.tokenHash`)
   * is stored. `createdByMemberId` records the issuing member (null if unknown).
   */
  issue(
    organizationId: string,
    invitation: Invitation,
    createdByMemberId: string | null,
    now: Date,
  ): Promise<Invitation>;
  /** Null for unknown ids and foreign-org ids (RLS scopes the read to the org). */
  getById(organizationId: string, invitationId: string): Promise<Invitation | null>;
  /** An org's invitations (optionally one status), newest first. */
  listByOrg(organizationId: string, status?: InvitationStatus): Promise<Invitation[]>;
  /**
   * Persist a transition produced by the invitation kernel (accepted / revoked /
   * expired) — writes status, accepted-by/at, and revoked-at. Returns the stored
   * record.
   */
  save(organizationId: string, invitation: Invitation, now: Date): Promise<Invitation>;
}

/** A stored `client_user_links` row — one active link binds a client to a user, each way. */
export interface ClientUserLinkRecord {
  id: string;
  organizationId: string;
  clientId: string;
  userId: string;
  status: "active" | "revoked";
  linkedAtIso: string;
  revokedAtIso: string | null;
}

export interface ClientUserLinkRepository {
  /**
   * Create an ACTIVE link binding `clientId` to `userId`. The DB's partial-unique
   * indexes reject a second active link for either side (a client already claimed,
   * or a user already linked to another client) — the repository surfaces that as
   * a `ClientAlreadyLinkedError`.
   */
  link(organizationId: string, clientId: string, userId: string, now: Date): Promise<ClientUserLinkRecord>;
  /** The active link for a client, or null. */
  getActiveByClient(organizationId: string, clientId: string): Promise<ClientUserLinkRecord | null>;
  /** The active link for a user, or null. */
  getActiveByUser(organizationId: string, userId: string): Promise<ClientUserLinkRecord | null>;
  /** Revoke an active link (idempotent-safe: revoking a missing/foreign link throws). */
  revoke(organizationId: string, linkId: string, now: Date): Promise<ClientUserLinkRecord>;
}
