import { describe, it, expect } from "vitest";
import { encrypt, decrypt, DecryptionError } from "@/lib/crypto";

describe("encrypt / decrypt", () => {
  it("round-trips a plaintext string", () => {
    const plaintext = "JBSWY3DPEHPK3PXP-a totp secret, not that it matters here";
    expect(decrypt(encrypt(plaintext))).toBe(plaintext);
  });

  it("produces different ciphertext for the same plaintext each time (random IV)", () => {
    const plaintext = "same value";
    expect(encrypt(plaintext)).not.toBe(encrypt(plaintext));
  });

  it("rejects tampered ciphertext instead of silently returning garbage", () => {
    const encrypted = encrypt("sensitive value");
    const bytes = Buffer.from(encrypted, "base64");
    bytes[bytes.length - 1] = bytes[bytes.length - 1]! ^ 0xff; // flip bits in the ciphertext
    const tampered = bytes.toString("base64");
    expect(() => decrypt(tampered)).toThrow(DecryptionError);
  });

  it("rejects a garbage/too-short payload", () => {
    expect(() => decrypt("not-valid-base64-ciphertext")).toThrow(DecryptionError);
  });
});
