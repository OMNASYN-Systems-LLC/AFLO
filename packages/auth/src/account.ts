/**
 * Account status + session revocation model (founder directive: disabled-account
 * handling + session revocation).
 *
 * PURE and deterministic. Governs whether a user's ACCOUNT is usable at all,
 * independent of role/membership: a disabled account gets no session, and a
 * revocation cutoff invalidates every session issued before it ("sign out
 * everywhere" / immediate lock-out on disable). The session context consults
 * these so a disabled or revoked identity resolves to null — fail closed at the
 * session layer, not only at the authorization engine.
 */

import type { AccountStatus } from "./authorization";

export interface AccountState {
  afloUserId: string;
  status: AccountStatus;
  /**
   * Sessions issued strictly before this instant are invalid (the revocation
   * cutoff). Null means nothing is revoked. Disabling sets it to the disable
   * time, so all live sessions die immediately.
   */
  sessionsInvalidatedBeforeIso: string | null;
  updatedAtIso: string;
}

export type AccountDenial = "already_active" | "already_disabled";

export type AccountResult =
  | { ok: true; account: AccountState }
  | { ok: false; reason: AccountDenial };

/**
 * Disable an account AND revoke every existing session (cutoff = nowIso). A
 * disabled user cannot sign in and their live sessions stop resolving at once.
 */
export function disableAccount(a: AccountState, nowIso: string): AccountResult {
  if (a.status === "disabled") return { ok: false, reason: "already_disabled" };
  return {
    ok: true,
    account: { ...a, status: "disabled", sessionsInvalidatedBeforeIso: nowIso, updatedAtIso: nowIso },
  };
}

/**
 * Reactivate a disabled account. The revocation cutoff is deliberately LEFT AS
 * IS — reactivation lets the user sign in again (new sessions), but does not
 * un-revoke the sessions that existed before the disable.
 */
export function reactivateAccount(a: AccountState, nowIso: string): AccountResult {
  if (a.status === "active") return { ok: false, reason: "already_active" };
  return { ok: true, account: { ...a, status: "active", updatedAtIso: nowIso } };
}

/** Revoke all sessions without changing status ("sign out everywhere"). */
export function revokeAllSessions(a: AccountState, nowIso: string): AccountState {
  return { ...a, sessionsInvalidatedBeforeIso: nowIso, updatedAtIso: nowIso };
}

/**
 * Is a session (issued at `sessionIssuedAtIso`) revoked by the account's cutoff?
 * Fails closed: an unparseable timestamp is treated as revoked.
 */
export function isSessionRevoked(
  sessionIssuedAtIso: string,
  sessionsInvalidatedBeforeIso: string | null,
): boolean {
  if (!sessionsInvalidatedBeforeIso) return false;
  const issued = Date.parse(sessionIssuedAtIso);
  const cutoff = Date.parse(sessionsInvalidatedBeforeIso);
  if (!Number.isFinite(issued) || !Number.isFinite(cutoff)) return true;
  return issued < cutoff;
}
