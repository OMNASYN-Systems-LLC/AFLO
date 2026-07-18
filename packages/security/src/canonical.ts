/**
 * Canonical JSON serialization for signing (security.v1.0.0).
 *
 * A signature is only meaningful if signer and verifier serialize the payload
 * identically. This produces a deterministic form: object keys sorted
 * recursively at every depth, arrays preserved in order. Values must be
 * JSON-safe (no functions, undefined, or cyclic references).
 */

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

function sortDeep(value: JsonValue): JsonValue {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value !== null && typeof value === "object") {
    const out: { [key: string]: JsonValue } = {};
    for (const key of Object.keys(value).sort()) {
      out[key] = sortDeep(value[key]!);
    }
    return out;
  }
  return value;
}

/** Deterministic canonical JSON string — identical for equal payloads. */
export function canonicalize(payload: JsonValue): string {
  return JSON.stringify(sortDeep(payload));
}
