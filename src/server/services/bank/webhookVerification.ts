import "server-only";
import { createHash } from "node:crypto";
import { importJWK, jwtVerify } from "jose";
import { getWebhookVerificationKey, type WebhookVerificationJwk } from "./plaidClient";

/**
 * PLAID WEBHOOK VERIFICATION — see
 * https://plaid.com/docs/api/webhooks/webhook-verification/. Every
 * webhook Plaid sends carries a `Plaid-Verification` header: a JWT whose
 * header names which of Plaid's public keys signed it (`kid`), and whose
 * payload carries `iat` (issued-at) and a SHA-256 hash of the raw request
 * body. Verifying it means: fetch that specific public key from Plaid,
 * check the signature, check it isn't stale, and check the body hash
 * actually matches what we received — all four, not just the signature,
 * or a replayed-but-differently-bodied request would pass.
 *
 * This is real, security-relevant code — never skip a step, never trust
 * an unverified body, and never accept a webhook whose signature check
 * fails for any reason.
 */

export class WebhookVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "WebhookVerificationError";
  }
}

const MAX_WEBHOOK_AGE_SECONDS = 5 * 60;

// Plaid recommends caching a fetched key rather than re-fetching per
// webhook, and refetching once if verification against a cached key
// fails (key rotation) rather than treating that as instant proof of
// tampering. Process-lifetime cache — fine for the sync frequency
// webhooks actually arrive at, and never grows unbounded (Plaid rotates
// keys rarely, so the number of distinct kids seen is always small).
const keyCache = new Map<string, WebhookVerificationJwk>();

function decodeKeyId(jwt: string): string {
  const headerB64 = jwt.split(".")[0];
  if (!headerB64) throw new WebhookVerificationError("Malformed webhook signature");
  try {
    const header = JSON.parse(Buffer.from(headerB64, "base64url").toString("utf8")) as { kid?: string };
    if (!header.kid) throw new Error("no kid");
    return header.kid;
  } catch {
    throw new WebhookVerificationError("Malformed webhook signature");
  }
}

async function getKey(keyId: string, forceRefresh: boolean): Promise<WebhookVerificationJwk> {
  if (!forceRefresh) {
    const cached = keyCache.get(keyId);
    if (cached) return cached;
  }
  const fresh = await getWebhookVerificationKey(keyId);
  keyCache.set(keyId, fresh);
  return fresh;
}

/**
 * Verifies a Plaid webhook. Throws WebhookVerificationError on ANY
 * failure — missing header, malformed JWT, bad signature, stale
 * timestamp, or a body that doesn't match its claimed hash. Callers must
 * treat this as all-or-nothing: there is no partial trust.
 *
 * `rawBody` must be the exact, unparsed request body text — hashing a
 * re-serialized JSON.parse(body) result would not necessarily match, and
 * would defeat the point of checking the hash at all.
 */
export async function verifyPlaidWebhook(rawBody: string, verificationHeader: string | null): Promise<void> {
  if (!verificationHeader) {
    throw new WebhookVerificationError("Missing Plaid-Verification header");
  }

  const keyId = decodeKeyId(verificationHeader);

  let payload: Record<string, unknown>;
  try {
    const jwk = await getKey(keyId, false);
    const key = await importJWK(jwk, "ES256");
    ({ payload } = await jwtVerify(verificationHeader, key, { algorithms: ["ES256"] }));
  } catch {
    // The cached key may be stale (Plaid rotated it) -- refetch once and
    // retry before concluding the signature is genuinely invalid.
    try {
      const jwk = await getKey(keyId, true);
      const key = await importJWK(jwk, "ES256");
      ({ payload } = await jwtVerify(verificationHeader, key, { algorithms: ["ES256"] }));
    } catch {
      throw new WebhookVerificationError("Invalid webhook signature");
    }
  }

  const iat = typeof payload.iat === "number" ? payload.iat : null;
  if (iat === null || Date.now() / 1000 - iat > MAX_WEBHOOK_AGE_SECONDS) {
    throw new WebhookVerificationError("Webhook signature is too old to accept");
  }

  const claimedHash = payload.request_body_sha256;
  const actualHash = createHash("sha256").update(rawBody, "utf8").digest("hex");
  if (claimedHash !== actualHash) {
    throw new WebhookVerificationError("Webhook body does not match its signed hash");
  }
}
