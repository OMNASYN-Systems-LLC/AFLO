import {
  createHash,
  generateKeyPairSync,
  sign as nodeSign,
  verify as nodeVerify,
  createPublicKey,
  createPrivateKey,
} from "node:crypto";

/**
 * Asymmetric signing primitives (security.v1.0.0).
 *
 * Ed25519 digital signatures over a canonical payload — a SHA-256 hash alone
 * is NOT a signature, so this uses a real asymmetric key. The private key
 * signs; anyone with the public key verifies. Keys carry a `keyId` for
 * rotation: a verifier selects the public key by the `keyId` recorded on the
 * signature. In production the private key lives in a managed KMS/HSM boundary
 * and never in the repo; this module is provider-neutral about where the key
 * material comes from.
 */

export const SECURITY_RULES_VERSION = "security.v1.0.0";
export const SIGNING_ALGORITHM = "ed25519";

export interface SigningKeyPair {
  keyId: string;
  /** PEM-encoded — the private half must be protected (KMS in production). */
  privateKeyPem: string;
  publicKeyPem: string;
}

/** SHA-256 hex digest of a string. Used for the payload digest, not as a signature. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Generate an Ed25519 key pair. The keyId is derived from the public key so
 * it is stable and self-describing (first 16 hex of its SHA-256).
 */
export function generateSigningKey(): SigningKeyPair {
  const { privateKey, publicKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const keyId = `key-${sha256Hex(publicKeyPem).slice(0, 16)}`;
  return { keyId, privateKeyPem, publicKeyPem };
}

/** Sign a canonical message; returns a base64 signature. */
export function sign(message: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  return nodeSign(null, Buffer.from(message, "utf8"), key).toString("base64");
}

/** Verify a base64 signature against the canonical message and public key. */
export function verify(message: string, signatureB64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return nodeVerify(null, Buffer.from(message, "utf8"), key, Buffer.from(signatureB64, "base64"));
  } catch {
    return false;
  }
}
