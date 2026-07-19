import { describe, expect, it } from "vitest";

import {
  assertAuthorized,
  AuthorizationError,
  authorize,
  DENIAL_REASONS,
  isSensitiveDenial,
  permissionsForRole,
  PERMISSIONS,
  ROLES,
  roleFromMemberRole,
  roleHasPermission,
  type AuthorizationRequest,
  type Principal,
  type Role,
} from "../src/index.js";

const ORG = "org-golden-key";
const OTHER_ORG = "org-rival";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    afloUserId: "user-1",
    role: "staff_advisor",
    accountStatus: "active",
    activeOrganizationId: ORG,
    membershipStatus: "active",
    ...overrides,
  };
}

function req(
  permission: AuthorizationRequest["permission"],
  p: Principal,
  resource: Partial<AuthorizationRequest["resource"]> = {},
): AuthorizationRequest {
  return { principal: p, permission, resource: { organizationId: ORG, ...resource } };
}

describe("policy map", () => {
  it("owner holds every permission", () => {
    const owner = permissionsForRole("organization_owner");
    for (const perm of PERMISSIONS) expect(owner.has(perm)).toBe(true);
  });

  it("admin is owner minus manage_members, keeps manage_settings", () => {
    expect(roleHasPermission("organization_admin", "organization.manage_members")).toBe(false);
    expect(roleHasPermission("organization_admin", "organization.manage_settings")).toBe(true);
  });

  it("staff cannot manage members, assign clients, read audit, or manage billing", () => {
    for (const perm of [
      "organization.manage_members",
      "client.assign",
      "audit.read",
      "billing.manage",
    ] as const) {
      expect(roleHasPermission("staff_advisor", perm)).toBe(false);
    }
    expect(roleHasPermission("staff_advisor", "roadmap.approve")).toBe(true);
  });

  it("client holds only self-service permissions", () => {
    expect(roleHasPermission("client", "client.read")).toBe(true);
    expect(roleHasPermission("client", "message.send")).toBe(true);
    expect(roleHasPermission("client", "roadmap.approve")).toBe(false);
    expect(roleHasPermission("client", "document.review")).toBe(false);
  });

  it("partner_viewer is reserved with no permissions", () => {
    expect(permissionsForRole("partner_viewer").size).toBe(0);
  });

  it("platform_admin reads cross-tenant but holds no approval/mutation permission", () => {
    expect(roleHasPermission("platform_admin", "client.read")).toBe(true);
    expect(roleHasPermission("platform_admin", "audit.read")).toBe(true);
    expect(roleHasPermission("platform_admin", "roadmap.approve")).toBe(false);
    expect(roleHasPermission("platform_admin", "client.update")).toBe(false);
  });

  it("bridges membership roles to authorization roles", () => {
    expect(roleFromMemberRole("staff")).toBe("staff_advisor");
    expect(roleFromMemberRole("organization_owner")).toBe("organization_owner");
    expect(roleFromMemberRole("organization_admin")).toBe("organization_admin");
  });
});

describe("authorize — happy paths", () => {
  it("allows staff to read a client in their org", () => {
    expect(authorize(req("client.read", principal(), { clientId: "c-1" }))).toEqual({
      allowed: true,
      reason: "allowed",
    });
  });

  it("allows owner to manage members", () => {
    const d = authorize(req("organization.manage_members", principal({ role: "organization_owner" })));
    expect(d.allowed).toBe(true);
  });

  it("allows a client to read their own linked record", () => {
    const p = principal({ role: "client", linkedClientId: "c-1" });
    expect(authorize(req("client.read", p, { clientId: "c-1" })).allowed).toBe(true);
  });
});

describe("authorize — fail-closed denials", () => {
  it("denies unauthenticated (no aflo user id)", () => {
    expect(authorize(req("client.read", principal({ afloUserId: "" }))).reason).toBe("unauthenticated");
  });

  it("denies a disabled account regardless of role", () => {
    const p = principal({ role: "organization_owner", accountStatus: "disabled" });
    expect(authorize(req("client.read", p)).reason).toBe("account_disabled");
  });

  it("denies pending / revoked / absent membership distinctly", () => {
    expect(authorize(req("client.read", principal({ membershipStatus: "pending" }))).reason).toBe(
      "membership_pending",
    );
    expect(authorize(req("client.read", principal({ membershipStatus: "revoked" }))).reason).toBe(
      "membership_revoked",
    );
    expect(authorize(req("client.read", principal({ membershipStatus: "none" }))).reason).toBe(
      "no_active_membership",
    );
  });

  it("denies cross-tenant access (staff acting on another org's resource)", () => {
    const d = authorize(req("client.read", principal(), { organizationId: OTHER_ORG, clientId: "c-1" }));
    expect(d).toEqual({ allowed: false, reason: "cross_tenant" });
  });

  it("denies a permission the role does not hold (deny-by-default)", () => {
    expect(authorize(req("audit.read", principal())).reason).toBe("permission_denied");
  });

  it("denies a client reading another client's record (IDOR)", () => {
    const p = principal({ role: "client", linkedClientId: "c-1" });
    expect(authorize(req("client.read", p, { clientId: "c-2" })).reason).toBe("not_owner");
  });

  it("denies a client with no linked client record", () => {
    const p = principal({ role: "client", linkedClientId: null });
    expect(authorize(req("client.read", p, { clientId: "c-1" })).reason).toBe("not_owner");
  });

  it("denies unassigned staff when assignment scoping is active", () => {
    const p = principal({ assignedClientIds: ["c-1", "c-2"] });
    expect(authorize(req("client.read", p, { clientId: "c-9" })).reason).toBe("not_assigned");
    // assigned client passes
    expect(authorize(req("client.read", p, { clientId: "c-1" })).allowed).toBe(true);
    // scoping OFF (null) → staff see all
    expect(authorize(req("client.read", principal({ assignedClientIds: null }), { clientId: "c-9" })).allowed).toBe(
      true,
    );
  });

  it("denies when consent is required but not granted", () => {
    const p = principal({ role: "organization_owner" });
    expect(
      authorize(req("document.download", p, { clientId: "c-1", consentRequired: true, consentGranted: false })).reason,
    ).toBe("consent_required");
    expect(
      authorize(req("document.download", p, { clientId: "c-1", consentRequired: true, consentGranted: true })).allowed,
    ).toBe(true);
  });

  it("denies a record-state mismatch", () => {
    const p = principal({ role: "organization_owner" });
    expect(
      authorize(req("roadmap.publish", p, { recordState: "draft", requiredRecordState: "approved" })).reason,
    ).toBe("invalid_record_state");
    expect(
      authorize(req("roadmap.publish", p, { recordState: "approved", requiredRecordState: "approved" })).allowed,
    ).toBe(true);
  });
});

describe("authorize — platform admin (cross-tenant, audited)", () => {
  const pa = principal({
    role: "platform_admin",
    activeOrganizationId: null,
    membershipStatus: "none",
  });

  it("reads any tenant's data without a membership or tenant match", () => {
    expect(authorize(req("client.read", pa, { organizationId: OTHER_ORG, clientId: "c-1" })).allowed).toBe(true);
    expect(authorize(req("audit.read", pa, { organizationId: OTHER_ORG })).allowed).toBe(true);
  });

  it("cannot perform tenant approvals or mutations", () => {
    expect(authorize(req("roadmap.approve", pa, { organizationId: OTHER_ORG })).reason).toBe("permission_denied");
    expect(authorize(req("client.update", pa, { organizationId: OTHER_ORG })).reason).toBe("permission_denied");
  });

  it("a disabled platform admin is still denied", () => {
    expect(authorize(req("client.read", { ...pa, accountStatus: "disabled" })).reason).toBe("account_disabled");
  });
});

describe("denial reasons + assert helper", () => {
  it("flags boundary-breach denials as sensitive (must audit)", () => {
    expect(isSensitiveDenial("cross_tenant")).toBe(true);
    expect(isSensitiveDenial("not_owner")).toBe(true);
    expect(isSensitiveDenial("not_assigned")).toBe(true);
    expect(isSensitiveDenial("membership_revoked")).toBe(true);
    expect(isSensitiveDenial("permission_denied")).toBe(false);
  });

  it("assertAuthorized throws AuthorizationError carrying the reason", () => {
    try {
      assertAuthorized(req("audit.read", principal()));
      expect.unreachable("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(AuthorizationError);
      expect((err as AuthorizationError).reason).toBe("permission_denied");
    }
  });

  it("every role and denial-reason constant is a stable string set", () => {
    expect(ROLES.length).toBe(6);
    expect(new Set<Role>(ROLES).size).toBe(6);
    expect(DENIAL_REASONS).toContain("allowed");
  });
});
