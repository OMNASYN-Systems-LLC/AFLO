/**
 * Deterministic virtual round-up / micro-allocation calculator (roundup.v1.0.0).
 *
 * SIMULATION ONLY. This models hypothetical round-up saving behavior for
 * education and goal visualization (charter V1 module). It never moves money,
 * never touches a real account, and never represents an actual transaction —
 * every input is synthetic or a user-entered hypothetical. The output is a
 * deterministic projection, not a financial guarantee.
 */

export const ROUNDUP_RULES_VERSION = "roundup.v1.0.0";

/**
 * The round-up on a single transaction: the amount needed to reach the next
 * `roundToCents` boundary, times the multiplier. An amount already on the
 * boundary rounds up by a full increment × multiplier (matching consumer
 * round-up products, where an exact-dollar purchase still contributes). All
 * integer-cent arithmetic — no floating-point drift.
 */
export function roundUpAmountCents(
  amountCents: number,
  roundToCents: number,
  multiplier: number,
): number {
  if (!Number.isFinite(amountCents) || amountCents < 0) return 0;
  if (!Number.isInteger(roundToCents) || roundToCents <= 0) return 0;
  if (!Number.isFinite(multiplier) || multiplier < 0) return 0;
  const remainder = amountCents % roundToCents;
  const base = remainder === 0 ? roundToCents : roundToCents - remainder;
  return Math.round(base * multiplier);
}

export interface RoundupSettings {
  roundToCents: number;
  multiplier: number;
  enabled: boolean;
}

/** Total round-up across a set of transaction amounts under the settings. */
export function totalRoundUpCents(
  amountCentsList: readonly number[],
  settings: RoundupSettings,
): number {
  if (!settings.enabled) return 0;
  return amountCentsList.reduce(
    (sum, amount) => sum + roundUpAmountCents(amount, settings.roundToCents, settings.multiplier),
    0,
  );
}

/**
 * Projected monthly savings: the observed round-up total over the sampled
 * transactions, scaled to a 30-day month by the sampled window in days.
 * Deterministic; a zero or negative window yields the raw total (no scaling).
 */
export function projectedMonthlySavingsCents(
  totalCents: number,
  windowDays: number,
): number {
  if (!Number.isFinite(windowDays) || windowDays <= 0) return totalCents;
  return Math.round((totalCents / windowDays) * 30);
}
