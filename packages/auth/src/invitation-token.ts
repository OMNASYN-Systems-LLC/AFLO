/**
 * Invitation token generation + verification (founder directive PHASE 5).
 *
 * SERVER-ONLY (imports `node:crypto`) — reachable via the subpath
 * `@aflo/auth/invitation-token`, never the package barrel, so crypto stays out
 * of any client bundle.
 *
 * The raw token is a high-entropy secret handed to the invitee (in the link);
 * ΛFLO stores only its sha256 hash (`Invitation.tokenHash`). At acceptance the
 * presented raw token is hashed and constant-time-compared to the stored hash.
 */

import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** Generate a fresh invitation token and its storable hash. */
export function generateInvitationToken(): { token: string; tokenHash: string } {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashInvitationToken(token) };
}

/** sha256 hex of a raw token — what gets stored on the invitation. */
export function hashInvitationToken(raw: string): string {
  return createHash("sha256").update(raw, "utf8").digest("hex");
}

/** Constant-time check that a presented raw token matches a stored hash. */
export function verifyInvitationToken(raw: string, tokenHash: string): boolean {
  const presented = Buffer.from(hashInvitationToken(raw), "hex");
  const stored = Buffer.from(tokenHash, "hex");
  return presented.length > 0 && presented.length === stored.length && timingSafeEqual(presented, stored);
}
