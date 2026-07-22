import { describe, expect, it } from "vitest";
import {
  ProviderSessionContextProvider,
  type PrincipalDirectory,
  type PrincipalRecords,
  type ProviderSessionSource,
  type SessionRevocationGate,
  type VerifiedProviderSession,
} from "../src/provider-session";
import type { AfloIdentity } from "../src/identity";

/**
 * Workstream B3 — the provider-backed session adapter, proven credential-free:
 * every Clerk-supplied fact is injected through the ports, and every failure
 * mode resolves to null (fail closed), never a guess.
 */

const SESSION: VerifiedProviderSession = {
  provider: "clerk",
  providerUserId: "clerk_user_1",
  providerSessionId: "sess_abc",
  issuedAtIso: "2026-07-22T12:00:00.000Z",
};

const IDENTITY: AfloIdentity = {
  afloUserId: "user-1",
  clerkUserId: "clerk_user_1",
  accountStatus: "active",
  isPlatformAdmin: false,
};

const STAFF_RECORDS: PrincipalRecords = {
  identity: IDENTITY,
  membership: {
    membershipId: "mem-1",
    organizationId: "org-1",
    memberRole: "staff",
    status: "active",
  },
  clientLink: null,
  assignedClientIds: null,
};

function sourceOf(session: VerifiedProviderSession | null): ProviderSessionSource {
  return { current: async () => session };
}

/** A directory stub that also records whether it was consulted. */
function directoryOf(records: PrincipalRecords | null): PrincipalDirectory & { calls: number } {
  const stub = {
    calls: 0,
    async loadByProviderUser() {
      stub.calls += 1;
      return records;
    },
  };
  return stub;
}

describe("ProviderSessionContextProvider — fail-closed resolution", () => {
  it("resolves null with no verified provider session", async () => {
    const directory = directoryOf(STAFF_RECORDS);
    const provider = new ProviderSessionContextProvider({ source: sourceOf(null), directory });
    expect(await provider.resolve()).toBeNull();
    expect(directory.calls).toBe(0); // never consulted
  });

  it("rejects malformed session facts BEFORE touching the directory", async () => {
    const malformed: VerifiedProviderSession[] = [
      { ...SESSION, providerUserId: "" },
      { ...SESSION, providerUserId: "   " },
      { ...SESSION, providerSessionId: "" },
      { ...SESSION, issuedAtIso: "not-a-date" },
      { ...SESSION, issuedAtIso: "" },
    ];
    for (const session of malformed) {
      const directory = directoryOf(STAFF_RECORDS);
      const provider = new ProviderSessionContextProvider({ source: sourceOf(session), directory });
      expect(await provider.resolve(), JSON.stringify(session)).toBeNull();
      expect(directory.calls).toBe(0);
    }
  });

  it("resolves null for an authenticated-but-unmapped provider identity", async () => {
    // Authentication alone grants nothing — the identity-claiming invariant:
    // a Clerk account with no invitation-bound ΛFLO user is a stranger.
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf(null),
    });
    expect(await provider.resolve()).toBeNull();
  });

  it("resolves null when the directory's identity is not the mapping for THIS provider user", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf({
        ...STAFF_RECORDS,
        identity: { ...IDENTITY, clerkUserId: "clerk_user_OTHER" },
      }),
    });
    expect(await provider.resolve()).toBeNull();
  });
});

describe("ProviderSessionContextProvider — role resolution via buildSessionContext", () => {
  it("resolves a staff member: role from the membership row, org bound, session id threaded", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf(STAFF_RECORDS),
    });
    const ctx = await provider.resolve();
    expect(ctx).toMatchObject({
      sessionId: "sess_abc",
      clerkUserId: "clerk_user_1",
      afloUserId: "user-1",
      role: "staff_advisor",
      activeOrganizationId: "org-1",
      activeMembershipId: "mem-1",
      membershipStatus: "active",
      linkedClientId: null,
    });
  });

  it("resolves a client through their active link", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf({
        identity: IDENTITY,
        membership: null,
        clientLink: { clientId: "client-1", organizationId: "org-1" },
        assignedClientIds: null,
      }),
    });
    const ctx = await provider.resolve();
    expect(ctx).toMatchObject({
      role: "client",
      activeOrganizationId: "org-1",
      linkedClientId: "client-1",
    });
  });

  it("resolves a platform admin with no tenant binding", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf({
        identity: { ...IDENTITY, isPlatformAdmin: true },
        membership: null,
        clientLink: null,
        assignedClientIds: null,
      }),
    });
    const ctx = await provider.resolve();
    expect(ctx).toMatchObject({ role: "platform_admin", activeOrganizationId: null });
  });

  it("a disabled account resolves to NO session (not merely a denial)", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf({
        ...STAFF_RECORDS,
        identity: { ...IDENTITY, accountStatus: "disabled" },
      }),
    });
    expect(await provider.resolve()).toBeNull();
  });

  it("the revoke-ALL cutoff applies through the threaded issuedAtIso", async () => {
    const withCutoff = (cutoffIso: string): PrincipalRecords => ({
      ...STAFF_RECORDS,
      identity: { ...IDENTITY, sessionsInvalidatedBeforeIso: cutoffIso },
    });
    // Issued BEFORE the cutoff → revoked → null.
    const revoked = new ProviderSessionContextProvider({
      source: sourceOf(SESSION), // issued 12:00
      directory: directoryOf(withCutoff("2026-07-22T13:00:00.000Z")),
    });
    expect(await revoked.resolve()).toBeNull();
    // Issued AFTER the cutoff → still live.
    const live = new ProviderSessionContextProvider({
      source: sourceOf({ ...SESSION, issuedAtIso: "2026-07-22T14:00:00.000Z" }),
      directory: directoryOf(withCutoff("2026-07-22T13:00:00.000Z")),
    });
    expect(await live.resolve()).not.toBeNull();
  });
});

describe("ProviderSessionContextProvider — digest-specific revocation gate", () => {
  it("a revoked session resolves null; the gate receives the aflo user + RAW session id", async () => {
    const seen: unknown[] = [];
    const gate: SessionRevocationGate = {
      async isRevoked(afloUserId, providerSessionId, sessionIssuedAtIso) {
        seen.push([afloUserId, providerSessionId, sessionIssuedAtIso]);
        return true;
      },
    };
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf(STAFF_RECORDS),
      revocationGate: gate,
    });
    expect(await provider.resolve()).toBeNull();
    expect(seen).toEqual([["user-1", "sess_abc", "2026-07-22T12:00:00.000Z"]]);
  });

  it("an un-revoked session resolves normally through the gate", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf(STAFF_RECORDS),
      revocationGate: { isRevoked: async () => false },
    });
    expect(await provider.resolve()).not.toBeNull();
  });

  it("a failing revocation store fails CLOSED (the error propagates; no session is minted)", async () => {
    const provider = new ProviderSessionContextProvider({
      source: sourceOf(SESSION),
      directory: directoryOf(STAFF_RECORDS),
      revocationGate: {
        isRevoked: async () => {
          throw new Error("revocation store unavailable");
        },
      },
    });
    await expect(provider.resolve()).rejects.toThrow("revocation store unavailable");
  });
});
