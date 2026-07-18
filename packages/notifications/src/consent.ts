/**
 * Consent gate for outbound communications (notification.v1.0.0).
 *
 * No communication is ever planned without an active consent of the required
 * type. Consent records are append-only (DATABASE_SCHEMA.md §2): a revocation
 * is a new `granted: false` row, so "active" means the LATEST record for a
 * (user, type) pair is granted. Fail closed — absent or stale consent
 * suppresses the send.
 */

/** Mirrors the schema `consent_type` enum. */
export const CONSENT_TYPES = [
  "terms_of_service",
  "privacy_policy",
  "data_processing",
  "communication",
  "partner_data_sharing",
] as const;

export type ConsentType = (typeof CONSENT_TYPES)[number];

export interface ConsentRecord {
  userId: string;
  consentType: ConsentType;
  granted: boolean;
  /** ISO datetime — the latest record for a (user, type) pair is authoritative. */
  recordedAt: string;
}

/**
 * Is the given consent type currently active for the user? True only when the
 * most recent record for that pair is a grant. Records for other users/types
 * are ignored; unparseable timestamps are rejected (fail closed).
 */
export function hasActiveConsent(
  records: readonly ConsentRecord[],
  userId: string,
  consentType: ConsentType,
): boolean {
  let latest: ConsentRecord | null = null;
  let latestMs = -Infinity;
  for (const r of records) {
    if (r.userId !== userId || r.consentType !== consentType) continue;
    const ms = Date.parse(r.recordedAt);
    if (Number.isNaN(ms)) throw new TypeError(`consent record has an invalid timestamp: ${r.recordedAt}`);
    if (ms >= latestMs) {
      latestMs = ms;
      latest = r;
    }
  }
  return latest?.granted === true;
}
