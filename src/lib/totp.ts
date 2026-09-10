import "server-only";
import crypto from "crypto";

/**
 * TOTP (RFC 6238, built on HOTP from RFC 4226) — hand-rolled rather than a
 * dependency, deliberately: the algorithm is small, fully specified, and
 * exactly the kind of thing this codebase prefers to own and unit-test
 * directly (see src/lib/money.ts for the same philosophy applied to
 * money math). `hotp()` below is verified against the official RFC 4226
 * Appendix D test vectors in tests/totp.test.ts.
 *
 * Compatible with standard authenticator apps (Google Authenticator, Authy,
 * 1Password, etc.): SHA-1, 6 digits, 30-second step — this is the de facto
 * universal default those apps assume even though RFC 6238 allows other
 * parameters, and deviating from it would make the QR code silently fail
 * to work in most authenticator apps.
 */

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const SECRET_BYTES = 20; // 160 bits — standard TOTP secret size
const DIGITS = 6;
const STEP_SECONDS = 30;
const CLOCK_DRIFT_STEPS = 1; // tolerate ±30s of clock skew between server and phone

export function base32Encode(buffer: Buffer): string {
  let bits = "";
  for (const byte of buffer) bits += byte.toString(2).padStart(8, "0");
  let output = "";
  for (let i = 0; i + 5 <= bits.length; i += 5) {
    output += BASE32_ALPHABET[parseInt(bits.slice(i, i + 5), 2)];
  }
  const remainder = bits.length % 5;
  if (remainder !== 0) {
    const last = bits.slice(bits.length - remainder).padEnd(5, "0");
    output += BASE32_ALPHABET[parseInt(last, 2)];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, "").replace(/[^A-Z2-7]/g, "");
  let bits = "";
  for (const char of clean) {
    const value = BASE32_ALPHABET.indexOf(char);
    if (value === -1) throw new Error("Invalid base32 character in TOTP secret");
    bits += value.toString(2).padStart(5, "0");
  }
  const bytes: number[] = [];
  for (let i = 0; i + 8 <= bits.length; i += 8) {
    bytes.push(parseInt(bits.slice(i, i + 8), 2));
  }
  return Buffer.from(bytes);
}

/** A fresh random secret, base32-encoded for QR/manual entry. */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(SECRET_BYTES));
}

/** RFC 4226 HOTP: HMAC-SHA1 the counter, then dynamically truncate to a
 * DIGITS-length decimal code. `counter` is the raw HOTP counter — TOTP is
 * just HOTP with counter = floor(unixSeconds / STEP_SECONDS). */
export function hotp(secret: Buffer, counter: number): string {
  const counterBuffer = Buffer.alloc(8);
  counterBuffer.writeBigUInt64BE(BigInt(counter));
  const hmac = crypto.createHmac("sha1", secret).update(counterBuffer).digest();

  const offset = hmac[hmac.length - 1]! & 0x0f;
  const binary =
    ((hmac[offset]! & 0x7f) << 24) |
    ((hmac[offset + 1]! & 0xff) << 16) |
    ((hmac[offset + 2]! & 0xff) << 8) |
    (hmac[offset + 3]! & 0xff);

  const otp = binary % 10 ** DIGITS;
  return otp.toString().padStart(DIGITS, "0");
}

function counterAt(unixMillis: number): number {
  return Math.floor(unixMillis / 1000 / STEP_SECONDS);
}

/** The current 6-digit code for a base32 secret. Exposed mainly for tests
 * and the setup-confirmation UI's own reasoning — verification should
 * always go through verifyTotp(), not a direct string comparison, so
 * clock-drift tolerance and timing-safety are never accidentally skipped. */
export function generateTotp(base32Secret: string, at: number = Date.now()): string {
  return hotp(base32Decode(base32Secret), counterAt(at));
}

function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  return crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));
}

/** Verifies a 6-digit code against the secret, tolerating up to
 * ±CLOCK_DRIFT_STEPS steps of clock skew. Timing-safe comparison so a
 * response-time side channel can't help an attacker narrow down digits. */
export function verifyTotp(base32Secret: string, token: string, at: number = Date.now()): boolean {
  if (!/^\d{6}$/.test(token)) return false;
  const secretBuffer = base32Decode(base32Secret);
  const currentCounter = counterAt(at);

  let matched = false;
  for (let drift = -CLOCK_DRIFT_STEPS; drift <= CLOCK_DRIFT_STEPS; drift++) {
    const candidate = hotp(secretBuffer, currentCounter + drift);
    // Deliberately check every window rather than short-circuiting on
    // match, so the function takes the same time regardless of which (if
    // any) window matched.
    if (timingSafeEqual(candidate, token)) matched = true;
  }
  return matched;
}

/** The otpauth:// URI authenticator apps scan as a QR code. */
export function otpauthUrl(params: { secret: string; accountEmail: string; issuer?: string }): string {
  const issuer = params.issuer ?? "Fable";
  const label = encodeURIComponent(`${issuer}:${params.accountEmail}`);
  const query = new URLSearchParams({
    secret: params.secret,
    issuer,
    algorithm: "SHA1",
    digits: String(DIGITS),
    period: String(STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${query.toString()}`;
}
