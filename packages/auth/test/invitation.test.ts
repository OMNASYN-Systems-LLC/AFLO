import { describe, expect, it } from "vitest";

import {
  acceptInvitation,
  expireInvitation,
  InvitationError,
  issueInvitation,
  revokeInvitation,
  type IssueInvitationInput,
} from "../src";
import {
  generateInvitationToken,
  hashInvitationToken,
  verifyInvitationToken,
} from "../src/invitation-token";

const ORG = "org-golden-key";
const T0 = "2026-07-19T00:00:00.000Z";
const T_BEFORE = "2026-07-25T00:00:00.000Z"; // within the 30-day window
const T_AFTER = "2026-09-01T00:00:00.000Z"; // past expiry
const EXPIRES = "2026-08-18T00:00:00.000Z";

function staffInvite(overrides: Partial<IssueInvitationInput> = {}) {
  return issueInvitation({
    id: "inv-staff-1",
    organizationId: ORG,
    email: "  Advisor@GoldenKey.com ",
    intendedRole: "staff_advisor",
    tokenHash: "hash-staff",
    createdAtIso: T0,
    expiresAtIso: EXPIRES,
    ...overrides,
  });
}

function clientInvite(overrides: Partial<IssueInvitationInput> = {}) {
  return issueInvitation({
    id: "inv-client-1",
    organizationId: ORG,
    email: "client@example.com",
    intendedRole: "client",
    reservedClientId: "c-1",
    tokenHash: "hash-client",
    createdAtIso: T0,
    expiresAtIso: EXPIRES,
    ...overrides,
  });
}

describe("issueInvitation", () => {
  it("normalizes email and starts pending", () => {
    const inv = staffInvite();
    expect(inv.email).toBe("advisor@goldenkey.com");
    expect(inv.status).toBe("pending");
    expect(inv.reservedClientId).toBeNull();
  });

  it("reserves the client for a client invitation", () => {
    expect(clientInvite().reservedClientId).toBe("c-1");
  });

  it("rejects a client invitation with no reserved client, and a staff invite that reserves one", () => {
    expect(() => issueInvitation({ ...({} as IssueInvitationInput), id: "x", organizationId: ORG, email: "a@b.c", intendedRole: "client", tokenHash: "h", createdAtIso: T0, expiresAtIso: EXPIRES })).toThrow(
      InvitationError,
    );
    expect(() => staffInvite({ reservedClientId: "c-9" })).toThrow(InvitationError);
  });
});

describe("acceptInvitation", () => {
  it("accepts a valid pending invitation and binds from the invitation", () => {
    const res = acceptInvitation(clientInvite(), { afloUserId: "user-1", email: "CLIENT@example.com", nowIso: T_BEFORE });
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.invitation.status).toBe("accepted");
    expect(res.invitation.acceptedByAfloUserId).toBe("user-1");
    expect(res.binding).toEqual({ afloUserId: "user-1", organizationId: ORG, role: "client", clientId: "c-1" });
  });

  it("SECURITY: a client cannot claim a different client or org than the invitation", () => {
    const inv = clientInvite();
    expect(
      acceptInvitation(inv, { afloUserId: "user-1", email: "client@example.com", nowIso: T_BEFORE, claimedClientId: "c-999" }),
    ).toEqual({ ok: false, reason: "client_mismatch" });
    expect(
      acceptInvitation(inv, { afloUserId: "user-1", email: "client@example.com", nowIso: T_BEFORE, claimedOrganizationId: "org-rival" }),
    ).toEqual({ ok: false, reason: "org_mismatch" });
    // Even matching claims still bind FROM the invitation, never the claim.
    const ok = acceptInvitation(inv, { afloUserId: "user-1", email: "client@example.com", nowIso: T_BEFORE, claimedClientId: "c-1" });
    expect(ok.ok && ok.binding?.clientId).toBe("c-1");
  });

  it("rejects a wrong email", () => {
    expect(acceptInvitation(clientInvite(), { afloUserId: "u", email: "someone-else@example.com", nowIso: T_BEFORE })).toEqual({
      ok: false,
      reason: "email_mismatch",
    });
  });

  it("rejects an expired invitation", () => {
    expect(acceptInvitation(clientInvite(), { afloUserId: "u", email: "client@example.com", nowIso: T_AFTER })).toEqual({
      ok: false,
      reason: "expired",
    });
  });

  it("rejects double-accept / revoked / expired-status invitations", () => {
    const accepted = acceptInvitation(clientInvite(), { afloUserId: "u", email: "client@example.com", nowIso: T_BEFORE });
    if (!accepted.ok) throw new Error("setup");
    expect(acceptInvitation(accepted.invitation, { afloUserId: "u2", email: "client@example.com", nowIso: T_BEFORE }).ok).toBe(false);
    expect(acceptInvitation(accepted.invitation, { afloUserId: "u2", email: "client@example.com", nowIso: T_BEFORE })).toEqual({
      ok: false,
      reason: "already_accepted",
    });
  });
});

describe("revoke / expire", () => {
  it("revokes a pending invitation and blocks acceptance after", () => {
    const revoked = revokeInvitation(staffInvite());
    expect(revoked.ok && revoked.invitation.status).toBe("revoked");
    if (!revoked.ok) return;
    expect(acceptInvitation(revoked.invitation, { afloUserId: "u", email: "advisor@goldenkey.com", nowIso: T_BEFORE })).toEqual({
      ok: false,
      reason: "already_revoked",
    });
  });

  it("expires only a pending, past-expiry invitation", () => {
    expect(expireInvitation(staffInvite(), T_AFTER).ok).toBe(true);
    expect(expireInvitation(staffInvite(), T_BEFORE)).toEqual({ ok: false, reason: "not_expired" });
  });

  it("cannot revoke an already-accepted invitation", () => {
    const accepted = acceptInvitation(clientInvite(), { afloUserId: "u", email: "client@example.com", nowIso: T_BEFORE });
    if (!accepted.ok) throw new Error("setup");
    expect(revokeInvitation(accepted.invitation)).toEqual({ ok: false, reason: "already_accepted" });
  });
});

describe("invitation-token (server-only subpath)", () => {
  it("generates a token whose hash matches, and verifies constant-time", () => {
    const { token, tokenHash } = generateInvitationToken();
    expect(hashInvitationToken(token)).toBe(tokenHash);
    expect(verifyInvitationToken(token, tokenHash)).toBe(true);
    expect(verifyInvitationToken("wrong-token", tokenHash)).toBe(false);
    expect(verifyInvitationToken(token, "")).toBe(false);
  });
});
