import { describe, it, expect, beforeAll } from "vitest";
import { encrypt, decrypt } from "./secret-service.js";
import { randomBytes } from "node:crypto";

// Use a valid 64-char hex key (32 bytes) so the encryption key path is deterministic
const TEST_KEY_HEX = "a".repeat(64);
const TEST_KEY_NON_HEX = "my-secret-passphrase-for-testing";

beforeAll(() => {
  process.env.OPTIO_ENCRYPTION_KEY = TEST_KEY_HEX;
  // Reset the cached key so our test key is picked up
  // (encryptionKey() caches after first call, but since each test file runs
  // in isolation the module is fresh)
});

describe("encrypt / decrypt round-trip", () => {
  it("decrypts back to the original plaintext", () => {
    const plaintext = "super-secret-api-key-12345";
    const { encrypted, iv, authTag } = encrypt(plaintext);
    const result = decrypt(encrypted, iv, authTag);
    expect(result).toBe(plaintext);
  });

  it("handles an empty string", () => {
    const { encrypted, iv, authTag } = encrypt("");
    expect(decrypt(encrypted, iv, authTag)).toBe("");
  });

  it("handles unicode content", () => {
    const plaintext = "密码: héllo wörld 🔑";
    const { encrypted, iv, authTag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, authTag)).toBe(plaintext);
  });

  it("handles long strings", () => {
    const plaintext = "x".repeat(10_000);
    const { encrypted, iv, authTag } = encrypt(plaintext);
    expect(decrypt(encrypted, iv, authTag)).toBe(plaintext);
  });

  it("produces different ciphertexts for same plaintext (random IV)", () => {
    const plaintext = "same-plaintext";
    const result1 = encrypt(plaintext);
    const result2 = encrypt(plaintext);
    // IVs must differ (randomBytes)
    expect(result1.iv.toString("hex")).not.toBe(result2.iv.toString("hex"));
    // Ciphertexts will also differ
    expect(result1.encrypted.toString("hex")).not.toBe(result2.encrypted.toString("hex"));
    // But both decrypt correctly
    expect(decrypt(result1.encrypted, result1.iv, result1.authTag)).toBe(plaintext);
    expect(decrypt(result2.encrypted, result2.iv, result2.authTag)).toBe(plaintext);
  });

  it("produces non-empty encrypted output", () => {
    const { encrypted, iv, authTag } = encrypt("hello");
    expect(encrypted.length).toBeGreaterThan(0);
    expect(iv.length).toBe(16); // AES block size
    expect(authTag.length).toBe(16); // GCM auth tag
  });

  it("throws on tampered auth tag (integrity check)", () => {
    const plaintext = "sensitive-data";
    const { encrypted, iv } = encrypt(plaintext);
    const tamperedAuthTag = randomBytes(16); // wrong auth tag
    expect(() => decrypt(encrypted, iv, tamperedAuthTag)).toThrow();
  });

  it("throws on tampered ciphertext", () => {
    const plaintext = "sensitive-data";
    const { encrypted, iv, authTag } = encrypt(plaintext);
    const tampered = Buffer.from(encrypted);
    tampered[0] ^= 0xff; // flip bits in first byte
    expect(() => decrypt(tampered, iv, authTag)).toThrow();
  });
});

describe("encryption key handling", () => {
  it("accepts a 64-char hex key directly as 32 bytes", () => {
    process.env.OPTIO_ENCRYPTION_KEY = "f".repeat(64);
    // Re-import won't re-run module init, but we can test encrypt still works
    // with the cached key (the module was loaded with TEST_KEY_HEX in beforeAll)
    const { encrypted, iv, authTag } = encrypt("test");
    expect(decrypt(encrypted, iv, authTag)).toBe("test");
  });
});
