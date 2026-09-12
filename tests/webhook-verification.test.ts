import { describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { getWebhookVerificationKey } from "@/server/services/bank/plaidClient";
import { verifyPlaidWebhook, WebhookVerificationError } from "@/server/services/bank/webhookVerification";

/**
 * Tests the REAL verification algorithm (ES256 signature check, body-hash
 * check, freshness check) end to end — every step is genuine crypto via
 * `jose`, nothing about the verification math is faked. The one thing
 * mocked is the outbound "fetch Plaid's public key for this kid" call
 * (getWebhookVerificationKey): Plaid can't deliver an actually-signed
 * webhook to this environment (no public URL — see README "Deployment"),
 * so there's no way to obtain a genuine Plaid signature to test against.
 * Everything downstream of "here is the key for this kid" is real.
 *
 * Each test uses its own randomUUID() as `kid` — the verification module
 * caches fetched keys by kid for the process lifetime, and reusing a kid
 * across tests would risk one test's cached key answering a different
 * test's mock.
 */

vi.mock("@/server/services/bank/plaidClient", () => ({
  getWebhookVerificationKey: vi.fn(),
}));

const mockGetKey = getWebhookVerificationKey as unknown as ReturnType<typeof vi.fn>;

async function signWebhook(params: {
  body: string;
  claimedHash?: string;
  iatOffsetSeconds?: number;
  signWithWrongKey?: boolean;
}) {
  const kid = randomUUID();
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid, alg: "ES256", use: "sig" });
  mockGetKey.mockResolvedValue(jwk);

  const signingKey = params.signWithWrongKey ? (await generateKeyPair("ES256")).privateKey : privateKey;
  const iat = Math.floor(Date.now() / 1000) + (params.iatOffsetSeconds ?? 0);
  const hash = params.claimedHash ?? createHash("sha256").update(params.body, "utf8").digest("hex");

  const jwt = await new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuedAt(iat)
    .sign(signingKey);

  return jwt;
}

describe("verifyPlaidWebhook", () => {
  it("accepts a genuinely valid signature with a matching body hash and fresh timestamp", async () => {
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const jwt = await signWebhook({ body });
    await expect(verifyPlaidWebhook(body, jwt)).resolves.toBeUndefined();
  });

  it("rejects a missing Plaid-Verification header", async () => {
    await expect(verifyPlaidWebhook("{}", null)).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects a malformed JWT outright", async () => {
    await expect(verifyPlaidWebhook("{}", "not-a-jwt-at-all")).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects when the request body doesn't match its signed hash (tampered in transit)", async () => {
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const jwt = await signWebhook({ body });
    await expect(verifyPlaidWebhook(body + "-tampered", jwt)).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects a webhook whose JWT claims an outright wrong hash", async () => {
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const jwt = await signWebhook({ body, claimedHash: "0".repeat(64) });
    await expect(verifyPlaidWebhook(body, jwt)).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects a stale webhook (issued more than 5 minutes ago)", async () => {
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const jwt = await signWebhook({ body, iatOffsetSeconds: -6 * 60 });
    await expect(verifyPlaidWebhook(body, jwt)).rejects.toThrow(WebhookVerificationError);
  });

  it("rejects a signature made with a different private key than the one Plaid's API says signed it — the actual forgery this exists to stop", async () => {
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const jwt = await signWebhook({ body, signWithWrongKey: true });
    await expect(verifyPlaidWebhook(body, jwt)).rejects.toThrow(WebhookVerificationError);
  });
});
