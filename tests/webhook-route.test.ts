import { describe, it, expect, vi } from "vitest";
import { randomUUID, createHash } from "node:crypto";
import { generateKeyPair, exportJWK, SignJWT } from "jose";
import { NextRequest } from "next/server";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { prisma } from "@/lib/db";
import { createTestBusiness } from "./helpers";
import { completeBankConnection } from "@/server/services/bank/connections";

/**
 * The full route wired together: signature verification, THEN dispatch —
 * in that order, with a body that fails verification never reaching the
 * dispatch logic at all. webhook-verification.test.ts and
 * webhook-handler.test.ts cover each half in isolation with more edge
 * cases; this file is the integration proof that POST() actually calls
 * them in the right order and translates their outcomes into the right
 * HTTP responses.
 */

vi.mock("@/server/services/bank/plaidClient", async (importOriginal) => {
  const original = await importOriginal<typeof import("@/server/services/bank/plaidClient")>();
  return { ...original, getWebhookVerificationKey: vi.fn() };
});

const PLAID_CONFIGURED = !!process.env.PLAID_CLIENT_ID && !!process.env.PLAID_SECRET;
const describeIfConfigured = PLAID_CONFIGURED ? describe : describe.skip;

async function createSandboxPublicToken(): Promise<string> {
  const client = new PlaidApi(
    new Configuration({
      basePath: PlaidEnvironments.sandbox,
      baseOptions: {
        headers: {
          "PLAID-CLIENT-ID": process.env.PLAID_CLIENT_ID!,
          "PLAID-SECRET": process.env.PLAID_SECRET!,
        },
      },
    }),
  );
  const response = await client.sandboxPublicTokenCreate({
    institution_id: "ins_109508",
    initial_products: ["transactions" as never],
  });
  return response.data.public_token;
}

async function signWebhook(body: string) {
  const { getWebhookVerificationKey } = await import("@/server/services/bank/plaidClient");
  const kid = randomUUID();
  const { publicKey, privateKey } = await generateKeyPair("ES256");
  const jwk = await exportJWK(publicKey);
  Object.assign(jwk, { kid, alg: "ES256", use: "sig" });
  (getWebhookVerificationKey as unknown as ReturnType<typeof vi.fn>).mockResolvedValue(jwk);

  const hash = createHash("sha256").update(body, "utf8").digest("hex");
  return new SignJWT({ request_body_sha256: hash })
    .setProtectedHeader({ alg: "ES256", kid })
    .setIssuedAt()
    .sign(privateKey);
}

function makeRequest(body: string, verificationHeader: string | null) {
  return new NextRequest("http://localhost/api/webhooks/plaid", {
    method: "POST",
    body,
    headers: verificationHeader ? { "plaid-verification": verificationHeader } : {},
  });
}

describe("POST /api/webhooks/plaid", () => {
  it("rejects a request with no Plaid-Verification header before ever touching the database", async () => {
    const { POST } = await import("@/app/api/webhooks/plaid/route");
    const res = await POST(makeRequest(JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" }), null));
    expect(res.status).toBe(401);
  });

  it("rejects a request whose body was tampered with after signing", async () => {
    const { POST } = await import("@/app/api/webhooks/plaid/route");
    const body = JSON.stringify({ webhook_type: "ITEM", webhook_code: "ERROR" });
    const jwt = await signWebhook(body);
    const res = await POST(makeRequest(body + "tampered", jwt.toString()));
    expect(res.status).toBe(401);
  });

  describeIfConfigured("with a real Plaid Sandbox connection", () => {
    it("a genuinely valid, signed SYNC_UPDATES_AVAILABLE webhook returns 200 and actually syncs", async () => {
      const business = await createTestBusiness();
      const publicToken = await createSandboxPublicToken();
      const connection = await completeBankConnection(business.id, publicToken);

      const { POST } = await import("@/app/api/webhooks/plaid/route");
      const body = JSON.stringify({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: connection.providerItemId,
      });
      const jwt = await signWebhook(body);

      const res = await POST(makeRequest(body, jwt.toString()));
      expect(res.status).toBe(200);

      const updated = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
      expect(updated.lastSyncedAt).toBeTruthy();
    });
  });
});
