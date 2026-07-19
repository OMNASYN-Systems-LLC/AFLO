import { describe, expect, it } from "vitest";

import {
  applyAcceptedBinding,
  changeMemberRole,
  memberRoleFromRole,
  reinstateMembership,
  revokeMembership,
  roleFromMemberRole,
  type AcceptedBinding,
  type MemberRole,
  type MembershipRecord,
} from "../src";

const ORG = "org-golden-key";
const NOW = "2026-07-19T00:00:00.000Z";
const LATER = "2026-07-20T00:00:00.000Z";

function staffBinding(role: AcceptedBinding["role"] = "staff_advisor"): AcceptedBinding {
  return { afloUserId: "user-1", organizationId: ORG, role, clientId: null };
}

function record(overrides: Partial<MembershipRecord> = {}): MembershipRecord {
  return {
    membershipId: "mem-1",
    organizationId: ORG,
    afloUserId: "user-1",
    memberRole: "staff",
    status: "active",
    createdAtIso: NOW,
    updatedAtIso: NOW,
    ...overrides,
  };
}

describe("memberRoleFromRole", () => {
  it("maps membership roles and round-trips with roleFromMemberRole", () => {
    for (const mr of ["organization_owner", "organization_admin", "staff"] as const satisfies readonly MemberRole[]) {
      expect(memberRoleFromRole(roleFromMemberRole(mr))).toBe(mr);
    }
    // non-membership roles have no membership role
    expect(memberRoleFromRole("client")).toBeNull();
    expect(memberRoleFromRole("platform_admin")).toBeNull();
    expect(memberRoleFromRole("partner_viewer")).toBeNull();
  });
});

describe("applyAcceptedBinding", () => {
  it("creates an active staff membership from a staff binding", () => {
    const result = applyAcceptedBinding(staffBinding(), { membershipId: "mem-9", nowIso: NOW });
    expect(result.kind).toBe("membership");
    if (result.kind !== "membership") return;
    expect(result.membership).toEqual({
      membershipId: "mem-9",
      organizationId: ORG,
      afloUserId: "user-1",
      memberRole: "staff",
      status: "active",
      createdAtIso: NOW,
      updatedAtIso: NOW,
    });
  });

  it("maps owner/admin authorization roles to the membership role", () => {
    expect(
      applyAcceptedBinding(staffBinding("organization_owner"), { membershipId: "m", nowIso: NOW }),
    ).toMatchObject({ kind: "membership", membership: { memberRole: "organization_owner" } });
    expect(
      applyAcceptedBinding(staffBinding("organization_admin"), { membershipId: "m", nowIso: NOW }),
    ).toMatchObject({ kind: "membership", membership: { memberRole: "organization_admin" } });
  });

  it("creates a client link (not a membership) from a client binding", () => {
    const binding: AcceptedBinding = { afloUserId: "user-2", organizationId: ORG, role: "client", clientId: "c-1" };
    const result = applyAcceptedBinding(binding, { membershipId: "unused", nowIso: NOW });
    expect(result).toEqual({ kind: "client_link", clientLink: { clientId: "c-1", organizationId: ORG } });
  });

  it("rejects a client binding with no client, and an unbindable role", () => {
    expect(
      applyAcceptedBinding({ afloUserId: "u", organizationId: ORG, role: "client", clientId: null }, { membershipId: "m", nowIso: NOW }),
    ).toEqual({ kind: "rejected", reason: "missing_client" });
    // platform_admin / partner_viewer are not membership rows.
    expect(
      applyAcceptedBinding(staffBinding("platform_admin"), { membershipId: "m", nowIso: NOW }),
    ).toEqual({ kind: "rejected", reason: "not_a_membership_role" });
    expect(
      applyAcceptedBinding(staffBinding("partner_viewer"), { membershipId: "m", nowIso: NOW }),
    ).toEqual({ kind: "rejected", reason: "not_a_membership_role" });
  });
});

describe("membership transitions", () => {
  it("changes an active membership's role and stamps updatedAt", () => {
    const r = changeMemberRole(record(), "organization_admin", LATER);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.membership.memberRole).toBe("organization_admin");
    expect(r.membership.updatedAtIso).toBe(LATER);
  });

  it("rejects a role change on a non-active membership and a no-op role change", () => {
    expect(changeMemberRole(record({ status: "revoked" }), "organization_admin", LATER)).toEqual({
      ok: false,
      reason: "not_active",
    });
    expect(changeMemberRole(record(), "staff", LATER)).toEqual({ ok: false, reason: "same_role" });
  });

  it("revokes an active membership and blocks double-revoke", () => {
    const r = revokeMembership(record(), LATER);
    expect(r.ok && r.membership.status).toBe("revoked");
    if (!r.ok) return;
    expect(revokeMembership(r.membership, LATER)).toEqual({ ok: false, reason: "already_revoked" });
  });

  it("reinstates a revoked membership but not an already-active one", () => {
    expect(reinstateMembership(record({ status: "revoked" }), LATER)).toMatchObject({ ok: true, membership: { status: "active" } });
    expect(reinstateMembership(record(), LATER)).toEqual({ ok: false, reason: "already_active" });
  });

  it("never mutates the input record", () => {
    const original = record();
    revokeMembership(original, LATER);
    changeMemberRole(original, "organization_owner", LATER);
    expect(original).toEqual(record());
  });
});
