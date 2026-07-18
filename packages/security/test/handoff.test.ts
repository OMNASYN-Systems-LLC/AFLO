import { describe, expect, it } from "vitest";
import {
  assembleHandoffPackage,
  canonicalize,
  generateSigningKey,
  sha256Hex,
  sign,
  verify,
  verifyHandoffPackage,
  type HandoffPackage,
} from "../src";

const KEY = generateSigningKey();
const resolver = (keyId: string) => (keyId === KEY.keyId ? KEY.publicKeyPem : null);

function pkg(overrides: Partial<Parameters<typeof assembleHandoffPackage>[0]> = {}): HandoffPackage {
  return assembleHandoffPackage({
    id: "hp-1",
    organizationId: "org-golden-key",
    clientId: "c-whitaker",
    recipientScope: "partner-cpa-org",
    consentScope: "consent-123",
    payload: { stage: "acquisition", score: 705, verified: true },
    issuedAt: "2026-07-18T12:00:00.000Z",
    expiresAt: "2026-08-18T12:00:00.000Z",
    keyId: KEY.keyId,
    privateKeyPem: KEY.privateKeyPem,
    ...overrides,
  });
}

describe("canonical + digest", () => {
  it("serializes equal payloads identically regardless of key order", () => {
    expect(canonicalize({ b: 1, a: 2 })).toBe(canonicalize({ a: 2, b: 1 }));
    expect(sha256Hex(canonicalize({ a: 2, b: 1 }))).toBe(sha256Hex(canonicalize({ b: 1, a: 2 })));
  });
});

describe("Ed25519 sign/verify", () => {
  it("round-trips a signature", () => {
    const msg = canonicalize({ x: 1 });
    const sig = sign(msg, KEY.privateKeyPem);
    expect(verify(msg, sig, KEY.publicKeyPem)).toBe(true);
  });

  it("rejects a tampered message and a wrong key", () => {
    const sig = sign("hello", KEY.privateKeyPem);
    expect(verify("hello!", sig, KEY.publicKeyPem)).toBe(false);
    const other = generateSigningKey();
    expect(verify("hello", sig, other.publicKeyPem)).toBe(false);
  });
});

describe("verifyHandoffPackage", () => {
  const NOW = new Date("2026-07-20T12:00:00.000Z");

  it("validates a well-formed, in-window package", () => {
    expect(verifyHandoffPackage(pkg(), resolver, NOW)).toEqual({ ok: true, verdict: "VALID" });
  });

  it("detects payload tampering (digest mismatch)", () => {
    const p = pkg();
    const tampered = { ...p, payload: { ...(p.payload as object), score: 800 } };
    expect(verifyHandoffPackage(tampered, resolver, NOW)).toMatchObject({ ok: false, verdict: "DIGEST_MISMATCH" });
  });

  it("detects a forged signature (digest kept consistent, signature wrong)", () => {
    const p = pkg();
    const other = generateSigningKey();
    const forged = { ...p, signature: sign(canonicalize(p.payload), other.privateKeyPem) };
    expect(verifyHandoffPackage(forged, resolver, NOW)).toMatchObject({ ok: false, verdict: "SIGNATURE_INVALID" });
  });

  it("rejects an unknown key id", () => {
    const p = { ...pkg(), keyId: "key-unknown" };
    expect(verifyHandoffPackage(p, resolver, NOW)).toMatchObject({ ok: false, verdict: "UNKNOWN_KEY" });
  });

  it("rejects an expired package", () => {
    expect(
      verifyHandoffPackage(pkg(), resolver, new Date("2026-09-01T00:00:00.000Z")),
    ).toMatchObject({ ok: false, verdict: "EXPIRED" });
  });

  it("rejects a revoked package before anything else", () => {
    const p = { ...pkg(), revokedAt: "2026-07-19T00:00:00.000Z" };
    expect(verifyHandoffPackage(p, resolver, NOW)).toMatchObject({ ok: false, verdict: "REVOKED" });
  });
});
