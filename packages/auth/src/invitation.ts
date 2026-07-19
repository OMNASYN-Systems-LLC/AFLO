/**
 * Invitation state machine (founder directive PHASE 5).
 *
 * PURE and deterministic — no I/O, no crypto (token hashing lives behind the
 * `@aflo/auth/invitation-token` subpath). Models the staff/client invitation
 * lifecycle and, critically, the identity-claiming invariant: **acceptance binds
 * the client/organization the invitation RESERVED — never a value the accepting
 * browser supplies.** One authenticated identity therefore cannot claim a
 * different client record than the one it was invited to.
 *
 * The Clerk invitation-API call (send the email, create the Clerk invite) is the
 * wiring follow-up; these rules govern ΛFLO's own invitation records.
 */

import type { Role } from "./roles";

export type InvitationStatus = "pending" | "accepted" | "revoked" | "expired";

export interface Invitation {
  id: string;
  organizationId: string;
  /** Normalized (lowercase, trimmed) invitee email. */
  email: string;
  intendedRole: Role;
  /** Client invitations reserve a specific client record; staff invitations are null. */
  reservedClientId: string | null;
  /** sha256 hex of the raw token; the raw token is never stored (opaque here). */
  tokenHash: string;
  status: InvitationStatus;
  createdAtIso: string;
  expiresAtIso: string;
  acceptedByAfloUserId: string | null;
  acceptedAtIso: string | null;
}

export type InvitationDenial =
  | "already_accepted"
  | "already_revoked"
  | "already_expired"
  | "expired"
  | "not_expired"
  | "email_mismatch"
  | "org_mismatch"
  | "client_mismatch";

/** The tenant binding produced by a successful acceptance — sourced from the invitation. */
export interface AcceptedBinding {
  afloUserId: string;
  organizationId: string;
  role: Role;
  clientId: string | null;
}

export type InvitationResult =
  | { ok: true; invitation: Invitation; binding?: AcceptedBinding }
  | { ok: false; reason: InvitationDenial };

/** Thrown by issueInvitation on a construction invariant violation (programmer error). */
export class InvitationError extends Error {
  constructor(public readonly reason: "invalid_client_invitation") {
    super(`invalid invitation: ${reason}`);
    this.name = "InvitationError";
  }
}

export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function deny(reason: InvitationDenial): InvitationResult {
  return { ok: false, reason };
}

function nonPendingDenial(status: Exclude<InvitationStatus, "pending">): InvitationDenial {
  switch (status) {
    case "accepted":
      return "already_accepted";
    case "revoked":
      return "already_revoked";
    case "expired":
      return "already_expired";
  }
}

/** Robust expiry check — fails closed (treats an unparseable timestamp as expired). */
function isPastExpiry(nowIso: string, expiresAtIso: string): boolean {
  const now = Date.parse(nowIso);
  const exp = Date.parse(expiresAtIso);
  return !Number.isFinite(now) || !Number.isFinite(exp) || now > exp;
}

export interface IssueInvitationInput {
  id: string;
  organizationId: string;
  email: string;
  intendedRole: Role;
  /** Required for a client invitation, forbidden otherwise. */
  reservedClientId?: string | null;
  tokenHash: string;
  createdAtIso: string;
  expiresAtIso: string;
}

/**
 * Construct a pending invitation. Enforces the client-binding invariant: a
 * `client`-role invitation MUST reserve a client; any other role MUST NOT.
 */
export function issueInvitation(input: IssueInvitationInput): Invitation {
  const isClient = input.intendedRole === "client";
  const reservedClientId = input.reservedClientId ?? null;
  if (isClient !== (reservedClientId !== null)) {
    throw new InvitationError("invalid_client_invitation");
  }
  return {
    id: input.id,
    organizationId: input.organizationId,
    email: normalizeEmail(input.email),
    intendedRole: input.intendedRole,
    reservedClientId,
    tokenHash: input.tokenHash,
    status: "pending",
    createdAtIso: input.createdAtIso,
    expiresAtIso: input.expiresAtIso,
    acceptedByAfloUserId: null,
    acceptedAtIso: null,
  };
}

export interface AcceptInvitationInput {
  /** The authenticated ΛFLO user accepting (never browser-supplied at the binding). */
  afloUserId: string;
  /** The accepting identity's VERIFIED email — must match the invitation. */
  email: string;
  nowIso: string;
  /**
   * Optional guardrails: if the acceptance flow echoes an org/client it thinks it
   * is joining, it MUST equal the invitation's own values. The binding always
   * comes from the invitation, so a mismatch is rejected — a user cannot accept an
   * invitation to claim a different client/organization than the one invited.
   */
  claimedOrganizationId?: string;
  claimedClientId?: string | null;
}

export function acceptInvitation(inv: Invitation, input: AcceptInvitationInput): InvitationResult {
  if (inv.status !== "pending") return deny(nonPendingDenial(inv.status));
  if (isPastExpiry(input.nowIso, inv.expiresAtIso)) return deny("expired");
  if (normalizeEmail(input.email) !== inv.email) return deny("email_mismatch");
  if (input.claimedOrganizationId !== undefined && input.claimedOrganizationId !== inv.organizationId) {
    return deny("org_mismatch");
  }
  if (input.claimedClientId !== undefined && (input.claimedClientId ?? null) !== inv.reservedClientId) {
    return deny("client_mismatch");
  }

  const invitation: Invitation = {
    ...inv,
    status: "accepted",
    acceptedByAfloUserId: input.afloUserId,
    acceptedAtIso: input.nowIso,
  };
  const binding: AcceptedBinding = {
    afloUserId: input.afloUserId,
    organizationId: inv.organizationId, // from the invitation, not the caller
    role: inv.intendedRole,
    clientId: inv.reservedClientId, // from the invitation, not the caller
  };
  return { ok: true, invitation, binding };
}

/** Revoke a still-pending invitation (owner/admin action). */
export function revokeInvitation(inv: Invitation): InvitationResult {
  if (inv.status !== "pending") return deny(nonPendingDenial(inv.status));
  return { ok: true, invitation: { ...inv, status: "revoked" } };
}

/** Expire a pending invitation that is past its expiry (maintenance job). */
export function expireInvitation(inv: Invitation, nowIso: string): InvitationResult {
  if (inv.status !== "pending") return deny(nonPendingDenial(inv.status));
  if (!isPastExpiry(nowIso, inv.expiresAtIso)) return deny("not_expired");
  return { ok: true, invitation: { ...inv, status: "expired" } };
}
