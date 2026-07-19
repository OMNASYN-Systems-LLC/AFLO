import { describe, expect, it } from "vitest";

import {
  authorize,
  buildSessionContext,
  permissionsForRole,
  requireSessionContext,
  TestSessionContextProvider,
  toPrincipal,
  UnresolvedSessionError,
  type AfloIdentity,
  type ClientLink,
  type Membership,
  type SessionContextInput,
} from "../src";

const ORG = "org-golden-key";
const OTHER_ORG = "org-rival";

function identity(overrides: Partial<AfloIdentity> = {}): AfloIdentity {
  return {
    afloUserId: "user-1",
    clerkUserId: "clerk_abc",
    accountStatus: "active",
    isPlatformAdmin: false,
    ...overrides,
  };
}

const staffMembership: Membership = {
  membershipId: "mem-1",
  organizationId: ORG,
  memberRole: "staff",
  status: "active",
};

const clientLink: ClientLink = { clientId: "c-1", organizationId: ORG };

function build(input: Partial<SessionContextInput> & { identity?: AfloIdentity } = {}) {
  return buildSessionContext({
    sessionId: "sess-1",
    identity: input.identity ?? identity(),
    membership: input.membership,
    clientLink: input.clientLink,
    assignedClientIds: input.assignedClientIds,
  });
}

describe("buildSessionContext — role resolution", () => {
  it("resolves a staff membership to staff_advisor with derived permissions", () => {
    const ctx = build({ membership: staffMembership })!;
    expect(ctx.role).toBe("staff_advisor");
    expect(ctx.activeOrganizationId).toBe(ORG);
    expect(ctx.activeMembershipId).toBe("mem-1");
    expect(ctx.membershipStatus).toBe("active");
    expect(ctx.linkedClientId).toBeNull();
    expect(ctx.permissions.has("roadmap.approve")).toBe(true);
    expect(ctx.permissions.has("audit.read")).toBe(false);
  });

  it("resolves an owner membership to organization_owner", () => {
    const ctx = build({ membership: { ...staffMembership, memberRole: "organization_owner" } })!;
    expect(ctx.role).toBe("organization_owner");
    expect(ctx.permissions).toEqual(permissionsForRole("organization_owner"));
  });

  it("carries a non-active membership status through (pending/revoked)", () => {
    expect(build({ membership: { ...staffMembership, status: "pending" } })!.membershipStatus).toBe("pending");
    expect(build({ membership: { ...staffMembership, status: "revoked" } })!.membershipStatus).toBe("revoked");
  });

  it("resolves a client link to the client role with an active tie", () => {
    const ctx = build({ clientLink })!;
    expect(ctx.role).toBe("client");
    expect(ctx.activeOrganizationId).toBe(ORG);
    expect(ctx.linkedClientId).toBe("c-1");
    expect(ctx.membershipStatus).toBe("active");
    expect(ctx.activeMembershipId).toBeNull();
  });

  it("resolves the platform-admin flag to platform_admin with no tenant binding", () => {
    const ctx = build({ identity: identity({ isPlatformAdmin: true }), membership: staffMembership })!;
    expect(ctx.role).toBe("platform_admin");
    expect(ctx.activeOrganizationId).toBeNull();
    expect(ctx.membershipStatus).toBe("none");
  });

  it("prefers a staff membership over a client link", () => {
    const ctx = build({ membership: staffMembership, clientLink })!;
    expect(ctx.role).toBe("staff_advisor");
    expect(ctx.linkedClientId).toBeNull();
  });

  it("returns null when no role can be resolved", () => {
    expect(build({})).toBeNull();
  });

  it("carries account status and assignment scoping", () => {
    const ctx = build({
      identity: identity({ accountStatus: "disabled" }),
      membership: staffMembership,
      assignedClientIds: ["c-1", "c-2"],
    })!;
    expect(ctx.accountStatus).toBe("disabled");
    expect(ctx.assignedClientIds).toEqual(["c-1", "c-2"]);
  });
});

describe("toPrincipal + authorize bridge (PHASE 2 → PHASE 4)", () => {
  it("a resolved staff context can read a client in its org", () => {
    const ctx = build({ membership: staffMembership })!;
    const d = authorize({
      principal: toPrincipal(ctx),
      permission: "client.read",
      resource: { organizationId: ORG, clientId: "c-9" },
    });
    expect(d.allowed).toBe(true);
  });

  it("a resolved client context reads its own record but not another's", () => {
    const p = toPrincipal(build({ clientLink })!);
    expect(
      authorize({ principal: p, permission: "message.read", resource: { organizationId: ORG, clientId: "c-1" } }).allowed,
    ).toBe(true);
    expect(
      authorize({ principal: p, permission: "message.read", resource: { organizationId: ORG, clientId: "c-2" } }).reason,
    ).toBe("not_owner");
  });

  it("a disabled account is denied through the bridge", () => {
    const p = toPrincipal(build({ identity: identity({ accountStatus: "disabled" }), membership: staffMembership })!);
    expect(authorize({ principal: p, permission: "client.read", resource: { organizationId: ORG } }).reason).toBe(
      "account_disabled",
    );
  });

  it("a revoked staff membership is denied through the bridge", () => {
    const p = toPrincipal(build({ membership: { ...staffMembership, status: "revoked" } })!);
    expect(authorize({ principal: p, permission: "client.read", resource: { organizationId: ORG } }).reason).toBe(
      "membership_revoked",
    );
  });

  it("a platform-admin context reads cross-tenant but cannot mutate", () => {
    const p = toPrincipal(build({ identity: identity({ isPlatformAdmin: true }) })!);
    expect(authorize({ principal: p, permission: "client.read", resource: { organizationId: OTHER_ORG } }).allowed).toBe(
      true,
    );
    expect(
      authorize({ principal: p, permission: "client.update", resource: { organizationId: OTHER_ORG } }).reason,
    ).toBe("permission_denied");
  });
});

describe("requireSessionContext + TestSessionContextProvider", () => {
  it("returns the context when resolved", async () => {
    const provider = TestSessionContextProvider.fromInput({
      sessionId: "sess-1",
      identity: identity(),
      membership: staffMembership,
    });
    const ctx = await requireSessionContext(provider);
    expect(ctx.role).toBe("staff_advisor");
  });

  it("fails closed (throws) on an unresolved session", async () => {
    await expect(requireSessionContext(TestSessionContextProvider.unauthenticated())).rejects.toBeInstanceOf(
      UnresolvedSessionError,
    );
  });

  it("fromInput with no resolvable role yields an unauthenticated provider", async () => {
    const provider = TestSessionContextProvider.fromInput({ sessionId: "s", identity: identity() });
    expect(await provider.resolve()).toBeNull();
  });
});
