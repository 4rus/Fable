import { describe, it, expect } from "vitest";
import {
  hotp,
  generateTotp,
  verifyTotp,
  generateTotpSecret,
  base32Encode,
  base32Decode,
  otpauthUrl,
} from "@/lib/totp";

// RFC 4226 Appendix D official test vectors: HMAC-SHA1, secret =
// ASCII "12345678901234567890" (20 bytes), counters 0-9. If hotp() ever
// disagrees with these, every authenticator app in the world will reject
// our codes -- this is the ground truth, not just a regression guard.
const RFC_4226_SECRET = Buffer.from("12345678901234567890", "ascii");
const RFC_4226_VECTORS = [
  "755224",
  "287082",
  "359152",
  "969429",
  "338314",
  "254676",
  "287922",
  "162583",
  "399871",
  "520489",
];

describe("hotp (RFC 4226 conformance)", () => {
  it.each(RFC_4226_VECTORS.map((code, counter) => [counter, code] as const))(
    "counter %i produces the official test vector %s",
    (counter, expected) => {
      expect(hotp(RFC_4226_SECRET, counter)).toBe(expected);
    },
  );
});

describe("base32Encode / base32Decode", () => {
  it("round-trips arbitrary bytes", () => {
    const original = Buffer.from([0, 1, 2, 253, 254, 255, 42, 17, 8]);
    expect(base32Decode(base32Encode(original))).toEqual(original);
  });

  it("round-trips a real generated secret", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]+$/);
    // Every generated secret must decode back to exactly SECRET_BYTES (20)
    // raw bytes -- a length mismatch here would mean generateTotp/verifyTotp
    // are silently working with truncated/padded key material.
    expect(base32Decode(secret)).toHaveLength(20);
  });
});

describe("generateTotp / verifyTotp", () => {
  it("verifies a code it just generated, at the same instant", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(secret, now);
    expect(verifyTotp(secret, code, now)).toBe(true);
  });

  it("rejects a code generated from a different secret", () => {
    const secretA = generateTotpSecret();
    const secretB = generateTotpSecret();
    const now = Date.now();
    const code = generateTotp(secretA, now);
    expect(verifyTotp(secretB, code, now)).toBe(false);
  });

  it("tolerates one step (30s) of clock drift in either direction", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const codeOneStepAgo = generateTotp(secret, now - 30_000);
    const codeOneStepAhead = generateTotp(secret, now + 30_000);
    expect(verifyTotp(secret, codeOneStepAgo, now)).toBe(true);
    expect(verifyTotp(secret, codeOneStepAhead, now)).toBe(true);
  });

  it("rejects a code from two steps (60s) away -- outside the drift window", () => {
    const secret = generateTotpSecret();
    const now = Date.now();
    const codeTwoStepsAgo = generateTotp(secret, now - 60_000);
    expect(verifyTotp(secret, codeTwoStepsAgo, now)).toBe(false);
  });

  it("rejects malformed input without throwing", () => {
    const secret = generateTotpSecret();
    expect(verifyTotp(secret, "abcdef", Date.now())).toBe(false);
    expect(verifyTotp(secret, "12345", Date.now())).toBe(false);
    expect(verifyTotp(secret, "", Date.now())).toBe(false);
  });
});

describe("otpauthUrl", () => {
  it("produces a scannable otpauth:// URI carrying the secret, issuer, and account", () => {
    const url = otpauthUrl({ secret: "JBSWY3DPEHPK3PXP", accountEmail: "owner@example.com" });
    expect(url).toMatch(/^otpauth:\/\/totp\//);
    expect(url).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(url).toContain("issuer=Fable");
    expect(decodeURIComponent(url)).toContain("Fable:owner@example.com");
  });
});
