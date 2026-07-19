/**
 * Versioned deterministic substrate for the Financial Resolution Concierge
 * loop (understand → diagnose → organize → educate → resolve → verify → route
 * → track → adapt). This kernel implements the DETERMINISTIC "understand"
 * primitive — readiness-input completeness — that nothing else computes: given
 * which verified inputs are captured, it reports what is known, what is still
 * missing, and whether the deterministic readiness diagnosis can run at all.
 *
 * It is pure and dependency-free (Architecture Rules 2–4). The loop's other
 * stages are served by existing kernels (readiness for "diagnose", engagement,
 * intake, education, roadmap, partner-routing); NONE of them — and nothing
 * here — is produced by AI. AI may only explain these outputs.
 */

export const RESOLUTION_RULES_VERSION = "resolution.v1.0.0";

/**
 * The governed resolution loop stages, in order. Canonical vocabulary; this
 * kernel is the deterministic substrate for the first three.
 */
export const RESOLUTION_LOOP_STAGES = [
  "understand",
  "diagnose",
  "organize",
  "educate",
  "resolve",
  "verify",
  "route",
  "track",
  "adapt",
] as const;

export type ResolutionLoopStage = (typeof RESOLUTION_LOOP_STAGES)[number];

/**
 * The seven verified inputs the readiness diagnosis consumes — identical to the
 * `ReadinessFacts` keys, so completeness is measured against exactly what the
 * diagnosis reads.
 */
export const READINESS_INPUT_KEYS = [
  "creditScore",
  "utilizationPct",
  "dtiPct",
  "reserveMonths",
  "derogatoryMarks",
  "onTimePaymentRate",
  "incomeStability",
] as const;

export type ReadinessInputKey = (typeof READINESS_INPUT_KEYS)[number];

/**
 * Inputs that MAY be absent without blocking the diagnosis. Only the credit
 * score is optional: the readiness engine accepts a null score (a thin-file
 * client is still assessable), but it cannot run without the other six facts,
 * which require both the financial and credit profiles to exist.
 */
export const OPTIONAL_READINESS_INPUT_KEYS: readonly ReadinessInputKey[] = ["creditScore"];

/** Inputs REQUIRED before the deterministic diagnosis can run. */
export const REQUIRED_READINESS_INPUT_KEYS: readonly ReadinessInputKey[] = READINESS_INPUT_KEYS.filter(
  (k) => !OPTIONAL_READINESS_INPUT_KEYS.includes(k),
);

/**
 * Whether each verified input is captured. A missing input is `false` — never
 * assumed present. Callers adapt their domain records into this shape (the
 * shared layer's `toReadinessInputPresence` does this for profiles).
 */
export type ReadinessInputPresence = Record<ReadinessInputKey, boolean>;

export interface ReadinessInputCompleteness {
  /** Inputs captured, in canonical key order. */
  capturedKeys: ReadinessInputKey[];
  /** Inputs not yet captured, in canonical key order (what "understand" still needs). */
  missingKeys: ReadinessInputKey[];
  /** Missing inputs that BLOCK the diagnosis (required and absent). */
  blockingMissingKeys: ReadinessInputKey[];
  /**
   * True iff every REQUIRED readiness INPUT is captured. This is the
   * verified-facts half of the store's run precondition only — intake
   * completion is a SEPARATE gate the store also enforces, so a consumer
   * deciding whether the diagnosis may actually run must AND this with intake
   * completeness (the readout's `canRunDiagnosis` does exactly that).
   */
  canDiagnose: boolean;
  /** 0..100 share of all seven inputs captured (deterministic, rounded). */
  completionPct: number;
  ruleVersion: string;
}

/**
 * Deterministic completeness over the readiness inputs. Fails closed: an input
 * whose presence flag is not exactly `true` counts as missing. `canDiagnose`
 * covers only the verified-facts half of the store's run precondition (both
 * profiles present), treating the credit score as non-blocking; intake
 * completion is a separate gate (see `canDiagnose`'s doc).
 */
export function readinessInputCompleteness(presence: ReadinessInputPresence): ReadinessInputCompleteness {
  const capturedKeys = READINESS_INPUT_KEYS.filter((k) => presence[k] === true);
  const missingKeys = READINESS_INPUT_KEYS.filter((k) => presence[k] !== true);
  const blockingMissingKeys = missingKeys.filter((k) => REQUIRED_READINESS_INPUT_KEYS.includes(k));
  const completionPct = Math.round((capturedKeys.length / READINESS_INPUT_KEYS.length) * 100);
  return {
    capturedKeys,
    missingKeys,
    blockingMissingKeys,
    canDiagnose: blockingMissingKeys.length === 0,
    completionPct,
    ruleVersion: RESOLUTION_RULES_VERSION,
  };
}
