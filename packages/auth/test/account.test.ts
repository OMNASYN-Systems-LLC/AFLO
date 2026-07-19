import { describe, expect, it } from "vitest";

import {
  disableAccount,
  isSessionRevoked,
  reactivateAccount,
  revokeAllSessions,
  type AccountState,
} from "../src";

const T0 = "2026-07-19T00:00:00.000Z";
const T1 = "2026-07-19T12:00:00.000Z";

function account(overrides: Partial<AccountState> = {}): AccountState {
  return {
    afloUserId: "user-1",
    status: "active",
    sessionsInvalidatedBeforeIso: null,
    updatedAtIso: T0,
    ...overrides,
  };
}

describe("account status transitions", () => {
  it("disables an active account and revokes all sessions at the disable time", () => {
    const r = disableAccount(account(), T1);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.account.status).toBe("disabled");
    expect(r.account.sessionsInvalidatedBeforeIso).toBe(T1);
    expect(r.account.updatedAtIso).toBe(T1);
  });

  it("rejects disabling an already-disabled account", () => {
    expect(disableAccount(account({ status: "disabled" }), T1)).toEqual({ ok: false, reason: "already_disabled" });
  });

  it("reactivates a disabled account but leaves the revocation cutoff (old sessions stay dead)", () => {
    const disabled = account({ status: "disabled", sessionsInvalidatedBeforeIso: T1 });
    const r = reactivateAccount(disabled, "2026-07-20T00:00:00.000Z");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.account.status).toBe("active");
    expect(r.account.sessionsInvalidatedBeforeIso).toBe(T1); // unchanged
  });

  it("rejects reactivating an already-active account", () => {
    expect(reactivateAccount(account(), T1)).toEqual({ ok: false, reason: "already_active" });
  });

  it("revokes all sessions without changing status (sign out everywhere)", () => {
    const r = revokeAllSessions(account(), T1);
    expect(r.status).toBe("active");
    expect(r.sessionsInvalidatedBeforeIso).toBe(T1);
  });

  it("never mutates the input account", () => {
    const original = account();
    disableAccount(original, T1);
    revokeAllSessions(original, T1);
    expect(original).toEqual(account());
  });
});

describe("isSessionRevoked", () => {
  it("no cutoff → never revoked", () => {
    expect(isSessionRevoked(T0, null)).toBe(false);
  });

  it("issued strictly before the cutoff → revoked; at/after → valid", () => {
    expect(isSessionRevoked("2026-07-19T11:59:59.000Z", T1)).toBe(true);
    expect(isSessionRevoked(T1, T1)).toBe(false); // boundary: equal is still valid
    expect(isSessionRevoked("2026-07-19T12:00:01.000Z", T1)).toBe(false);
  });

  it("fails closed on an unparseable timestamp", () => {
    expect(isSessionRevoked("not-a-date", T1)).toBe(true);
    expect(isSessionRevoked(T0, "not-a-date")).toBe(true);
  });
});
