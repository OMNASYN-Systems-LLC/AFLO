import { createCipheriv, createDecipheriv, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Application-layer field encryption (AES-256-GCM) for sensitive column values —
 * message bodies today, extensible to the other `encrypted` bytea columns
 * (phone, date-of-birth, storage keys). The database stores ONLY the ciphertext
 * produced here; plaintext never touches the DB, its backups, or its query
 * surface.
 *
 * Wire format of the returned buffer: `[12-byte IV][16-byte GCM tag][ciphertext]`.
 * A fresh random IV per call means encrypting the same plaintext twice yields
 * different ciphertext (no equality/length oracle across rows). GCM's auth tag
 * makes tampering detectable — `decrypt` throws rather than returning forged
 * plaintext.
 *
 * No key material lives in the repo: the 32-byte key is supplied at runtime
 * (from a secret env var, credential-gated) and injected into the cipher. Tests
 * use a generated ephemeral key, so the crypto path is proven credential-free.
 */

const IV_BYTES = 12;
const TAG_BYTES = 16;
const KEY_BYTES = 32; // AES-256
const ALGORITHM = "aes-256-gcm";

/** Thrown when a supplied key is not exactly 32 bytes, or a value cannot be decrypted. */
export class FieldEncryptionError extends Error {
  constructor(
    public readonly reason:
      | "invalid_key_length"
      | "invalid_key_encoding"
      | "malformed_ciphertext"
      | "decryption_failed",
    message?: string,
  ) {
    super(message ?? `field encryption error: ${reason}`);
    this.name = "FieldEncryptionError";
  }
}

/**
 * The encryption boundary the repositories depend on. Injected, never
 * env-reading — so a repository stays credential-free and testable, and the
 * key's provenance (env, KMS, test) is the caller's concern.
 */
export interface FieldCipher {
  /** Encrypt UTF-8 plaintext → `[IV][tag][ciphertext]` buffer. */
  encrypt(plaintext: string): Buffer;
  /** Decrypt a buffer produced by `encrypt`; throws on tamper/wrong key/malformed input. */
  decrypt(ciphertext: Buffer): string;
}

/** Build an AES-256-GCM cipher over a 32-byte key. */
export function createAesGcmFieldCipher(key: Buffer): FieldCipher {
  if (key.length !== KEY_BYTES) {
    throw new FieldEncryptionError("invalid_key_length", `key must be ${KEY_BYTES} bytes, got ${key.length}`);
  }
  // Copy so a caller mutating their buffer can't change our key underfoot.
  const k = Buffer.from(key);
  return {
    encrypt(plaintext: string): Buffer {
      const iv = randomBytes(IV_BYTES);
      const cipher = createCipheriv(ALGORITHM, k, iv);
      const enc = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
      const tag = cipher.getAuthTag();
      return Buffer.concat([iv, tag, enc]);
    },
    decrypt(payload: Buffer): string {
      if (payload.length < IV_BYTES + TAG_BYTES) {
        throw new FieldEncryptionError("malformed_ciphertext");
      }
      const iv = payload.subarray(0, IV_BYTES);
      const tag = payload.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
      const enc = payload.subarray(IV_BYTES + TAG_BYTES);
      const decipher = createDecipheriv(ALGORITHM, k, iv);
      decipher.setAuthTag(tag);
      try {
        return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
      } catch {
        // Wrong key or tampered ciphertext — never return forged plaintext.
        throw new FieldEncryptionError("decryption_failed");
      }
    },
  };
}

/**
 * Parse a base64-encoded 32-byte key (the env-var representation). Fails closed
 * on a wrong-length or non-base64 value, so a misconfigured deployment stops
 * rather than encrypting under a truncated/garbage key.
 */
export function parseFieldEncryptionKey(base64: string): Buffer {
  let key: Buffer;
  try {
    key = Buffer.from(base64, "base64");
  } catch {
    throw new FieldEncryptionError("invalid_key_encoding");
  }
  // Buffer.from is lenient (ignores invalid chars), so re-encode and compare to
  // reject values that aren't a clean base64 round-trip of exactly 32 bytes.
  if (key.length !== KEY_BYTES || key.toString("base64").replace(/=+$/, "") !== base64.replace(/=+$/, "")) {
    throw new FieldEncryptionError("invalid_key_length", `key must decode to ${KEY_BYTES} bytes`);
  }
  return key;
}

/** Generate a fresh 32-byte key (tooling / tests). Never checked into the repo. */
export function generateFieldEncryptionKey(): Buffer {
  return randomBytes(KEY_BYTES);
}

/** Constant-time buffer equality (exported for callers comparing digests/keys). */
export function buffersEqual(a: Buffer, b: Buffer): boolean {
  return a.length === b.length && timingSafeEqual(a, b);
}
