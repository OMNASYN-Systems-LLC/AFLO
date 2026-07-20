import { describe, expect, it } from "vitest";
import {
  FieldEncryptionError,
  createAesGcmFieldCipher,
  generateFieldEncryptionKey,
  parseFieldEncryptionKey,
} from "../src/field-encryption";

describe("AES-256-GCM field cipher", () => {
  const cipher = createAesGcmFieldCipher(generateFieldEncryptionKey());

  it("round-trips UTF-8 plaintext (incl. multibyte)", () => {
    for (const plaintext of ["", "hello", "Can we review my credit report?", "café ☕ — 你好 🔐"]) {
      expect(cipher.decrypt(cipher.encrypt(plaintext))).toBe(plaintext);
    }
  });

  it("never emits plaintext bytes: ciphertext does not contain the input", () => {
    const plaintext = "SENSITIVE-BODY-MARKER";
    const ct = cipher.encrypt(plaintext);
    expect(ct.toString("utf8")).not.toContain(plaintext);
    expect(ct.toString("latin1")).not.toContain(plaintext);
    // IV(12) + tag(16) + ciphertext(len) — always longer than the framing.
    expect(ct.length).toBeGreaterThan(12 + 16);
  });

  it("is non-deterministic (fresh IV): same plaintext → different ciphertext", () => {
    const a = cipher.encrypt("same");
    const b = cipher.encrypt("same");
    expect(a.equals(b)).toBe(false);
    // ...but both still decrypt back to the same plaintext.
    expect(cipher.decrypt(a)).toBe("same");
    expect(cipher.decrypt(b)).toBe("same");
  });

  it("rejects a tampered ciphertext (GCM auth) rather than returning forged plaintext", () => {
    const ct = cipher.encrypt("integrity");
    const last = ct.length - 1;
    ct.writeUInt8((ct[last]! ^ 0xff) & 0xff, last); // flip a byte in the ciphertext
    expect(() => cipher.decrypt(ct)).toThrow(FieldEncryptionError);
  });

  it("rejects decryption under a different key (no cross-key leak)", () => {
    const other = createAesGcmFieldCipher(generateFieldEncryptionKey());
    const ct = cipher.encrypt("secret");
    expect(() => other.decrypt(ct)).toThrow(/decryption_failed/);
  });

  it("rejects a truncated/malformed buffer", () => {
    expect(() => cipher.decrypt(Buffer.alloc(4))).toThrow(/malformed_ciphertext/);
  });

  it("rejects a wrong-length key at construction (fail closed)", () => {
    expect(() => createAesGcmFieldCipher(Buffer.alloc(16))).toThrow(FieldEncryptionError);
    expect(() => createAesGcmFieldCipher(Buffer.alloc(16))).toThrow(/32 bytes/);
  });
});

describe("key parsing", () => {
  it("parses a valid base64 32-byte key", () => {
    const key = generateFieldEncryptionKey();
    const parsed = parseFieldEncryptionKey(key.toString("base64"));
    expect(parsed.equals(key)).toBe(true);
  });

  it("fails closed on a wrong-length key (e.g. 16 bytes)", () => {
    const short = Buffer.alloc(16).toString("base64");
    expect(() => parseFieldEncryptionKey(short)).toThrow(FieldEncryptionError);
    expect(() => parseFieldEncryptionKey(short)).toThrow(/32 bytes/);
  });

  it("fails closed on a non-base64 / garbage value", () => {
    expect(() => parseFieldEncryptionKey("not a real key!!!")).toThrow(FieldEncryptionError);
  });
});
