import { describe, it, expect } from "vitest";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { prisma } from "@/lib/db";
import { createTestBusiness } from "./helpers";
import { completeBankConnection } from "@/server/services/bank/connections";
import { handlePlaidWebhook } from "@/server/services/bank/webhookHandler";

/**
 * Dispatch logic for an already-verified webhook, tested against real
 * BankConnection rows created via real Plaid Sandbox (same
 * sandboxPublicTokenCreate approach as tests/bank-connections.test.ts) --
 * not mocked. The signature-verification step has its own dedicated
 * tests (tests/webhook-verification.test.ts); this file only exercises
 * what happens once a webhook body is trusted.
 *
 * Skips entirely (not a failure) if PLAID_CLIENT_ID/PLAID_SECRET aren't
 * configured, matching the rest of the suite's treatment of optional
 * provider credentials.
 */

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

describeIfConfigured("handlePlaidWebhook (real Plaid Sandbox connections)", () => {
  it("TRANSACTIONS/SYNC_UPDATES_AVAILABLE triggers a real sync for the matching connection", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);
    expect(connection.lastSyncedAt).toBeNull();

    await handlePlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: connection.providerItemId,
    });

    const updated = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(updated.lastSyncedAt).toBeTruthy();
  });

  it("does not attempt a sync for a connection that isn't ACTIVE", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);
    await prisma.bankConnection.update({ where: { id: connection.id }, data: { status: "ERROR" } });

    await handlePlaidWebhook({
      webhook_type: "TRANSACTIONS",
      webhook_code: "SYNC_UPDATES_AVAILABLE",
      item_id: connection.providerItemId,
    });

    const updated = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(updated.lastSyncedAt).toBeNull(); // still never synced -- the guard skipped it
    expect(updated.status).toBe("ERROR"); // unchanged
  });

  it("ITEM/ERROR marks the connection ERROR with the reported error code", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);

    await handlePlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "ERROR",
      item_id: connection.providerItemId,
      error: { error_code: "ITEM_LOGIN_REQUIRED" },
    });

    const updated = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(updated.status).toBe("ERROR");
    expect(updated.errorCode).toBe("ITEM_LOGIN_REQUIRED");
  });

  it("ITEM/USER_PERMISSION_REVOKED disconnects the connection, keeping historical data", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);

    await handlePlaidWebhook({
      webhook_type: "ITEM",
      webhook_code: "USER_PERMISSION_REVOKED",
      item_id: connection.providerItemId,
    });

    const updated = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(updated.status).toBe("REVOKED");
  });

  it("does nothing for a webhook whose item_id matches no connection", async () => {
    await expect(
      handlePlaidWebhook({
        webhook_type: "TRANSACTIONS",
        webhook_code: "SYNC_UPDATES_AVAILABLE",
        item_id: "no-such-item-id",
      }),
    ).resolves.not.toThrow();
  });

  it("does nothing for a body that doesn't match the expected shape, rather than throwing", async () => {
    await expect(handlePlaidWebhook({ nonsense: true })).resolves.not.toThrow();
  });

  it("logs but does not act on a webhook_type/webhook_code it doesn't have a handler for yet", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);

    await expect(
      handlePlaidWebhook({ webhook_type: "ITEM", webhook_code: "LOGIN_REPAIRED", item_id: connection.providerItemId }),
    ).resolves.not.toThrow();

    const unchanged = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(unchanged.status).toBe("ACTIVE");
  });
});
