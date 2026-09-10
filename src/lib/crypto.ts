import "server-only";
import crypto from "crypto";

/**
 * Symmetric encryption for secrets we must be able to read back in
 * plaintext (so hashing, like passwords, doesn't apply) — currently the
 * TOTP secret behind two-factor auth (verifying a 6-digit code requires
 * recomputing HOTP from the real secret), and the intended home for
 * bank-provider access tokens once Phase E (bank connectivity) lands.
 *
 * AES-256-GCM: authenticated encryption, so a tampered/corrupted
 * ciphertext throws outright on decrypt instead of silently returning
 * garbage bytes.
 *
 * Key: ENCRYPTION_KEY env var, 32 raw bytes, base64-encoded. Generate with:
 *   node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"
 * Treat it with the same care as NEXTAUTH_SECRET — rotating it makes every
 * previously-encrypted value permanently undecryptable. There is
 * deliberately no fallback/no-op if it's missing: failing loudly beats
 * silently storing a secret in plaintext.
 */

const IV_BYTES = 12; // recommended AES-GCM nonce size
const AUTH_TAG_BYTES = 16;

function getKey(): Buffer {
  const raw = process.env.ENCRYPTION_KEY;
  if (!raw) {
    throw new Error(
      "ENCRYPTION_KEY is not set. Generate one with: " +
        `node -e "console.log(require('crypto').randomBytes(32).toString('base64'))"`,
    );
  }
  const key = Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error("ENCRYPTION_KEY must decode (base64) to exactly 32 bytes.");
  }
  return key;
}

/** Encrypts a UTF-8 string. Output packs iv + authTag + ciphertext into one
 * base64 string — nothing else needs to be stored alongside it. */
export function encrypt(plaintext: string): string {
  const key = getKey();
  const iv = crypto.randomBytes(IV_BYTES);
  const cipher = crypto.createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]).toString("base64");
}

export class DecryptionError extends Error {
  constructor() {
    super("Could not decrypt value — wrong key, or the ciphertext was tampered with/corrupted.");
    this.name = "DecryptionError";
  }
}

export function decrypt(payload: string): string {
  const key = getKey();
  const raw = Buffer.from(payload, "base64");
  if (raw.length < IV_BYTES + AUTH_TAG_BYTES) throw new DecryptionError();

  const iv = raw.subarray(0, IV_BYTES);
  const authTag = raw.subarray(IV_BYTES, IV_BYTES + AUTH_TAG_BYTES);
  const ciphertext = raw.subarray(IV_BYTES + AUTH_TAG_BYTES);

  try {
    const decipher = crypto.createDecipheriv("aes-256-gcm", key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString("utf8");
  } catch {
    // GCM auth-tag mismatch throws from decipher.final() — normalize to
    // our own error type rather than leaking a raw Node crypto error.
    throw new DecryptionError();
  }
}
