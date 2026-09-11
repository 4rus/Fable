import { describe, it, expect, beforeAll } from "vitest";
import { Configuration, PlaidApi, PlaidEnvironments } from "plaid";
import { prisma } from "@/lib/db";
import { decrypt } from "@/lib/crypto";
import { createTestBusiness } from "./helpers";
import {
  completeBankConnection,
  disconnectBankConnection,
  syncBankConnection,
  listBankConnections,
} from "@/server/services/bank/connections";
import { ForbiddenError } from "@/server/tenant";

/**
 * Real integration tests against Plaid's actual Sandbox API — not mocked.
 * Plaid provides `sandboxPublicTokenCreate` specifically so automated
 * tests can get a real public_token for a fake institution without
 * driving the Link UI, which is exactly what this suite uses. This
 * proves the whole connect -> store -> sync -> disconnect path works
 * against Plaid's real API contract, the same philosophy as testing
 * password reset/invoice email against a real Resend send.
 *
 * Skips entirely (not a failure) if PLAID_CLIENT_ID/PLAID_SECRET aren't
 * configured, matching how the rest of the suite treats optional
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
    institution_id: "ins_109508", // First Platypus Bank -- Plaid's standard Sandbox test institution
    initial_products: ["transactions" as never],
  });
  return response.data.public_token;
}

describeIfConfigured("bank connections (real Plaid Sandbox)", () => {
  it("completeBankConnection exchanges the token and stores an encrypted access token, never the raw one", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();

    const connection = await completeBankConnection(business.id, publicToken);

    expect(connection.institutionName).toBe("First Platypus Bank");
    expect(connection.accounts.length).toBeGreaterThan(0);

    const stored = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(stored.accessTokenEncrypted).not.toContain("access-sandbox"); // raw Plaid tokens are prefixed like this -- must never appear in plaintext
    expect(decrypt(stored.accessTokenEncrypted)).toMatch(/^access-sandbox-/); // but the REAL token is recoverable via decrypt()
  });

  it("writes an audit log entry on connect", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);

    const entry = await prisma.auditLog.findFirst({
      where: { businessId: business.id, action: "bank.connect", entityId: connection.id },
    });
    expect(entry).toBeTruthy();
  });

  it("syncBankConnection pages through transactions/sync and persists a cursor", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);

    const result = await syncBankConnection(business.id, connection.id);
    expect(result.addedCount).toBeGreaterThanOrEqual(0);

    const stored = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    // Plaid can legitimately return an empty (but non-null) next_cursor on
    // a brand-new Sandbox item before its test data has finished
    // generating -- a real API characteristic, not something to paper
    // over with a fake non-empty assertion.
    expect(stored.transactionsCursor).not.toBeNull();
    expect(stored.lastSyncedAt).toBeTruthy();
  });

  it("syncing twice never creates duplicate transactions for the same providerTransactionId", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);

    await syncBankConnection(business.id, connection.id);
    const countAfterFirst = await prisma.transaction.count({ where: { businessId: business.id } });

    await syncBankConnection(business.id, connection.id);
    const countAfterSecond = await prisma.transaction.count({ where: { businessId: business.id } });

    expect(countAfterSecond).toBe(countAfterFirst);
  });

  it("refuses to sync or disconnect a connection belonging to a different business (tenant isolation)", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(businessA.id, publicToken);

    await expect(syncBankConnection(businessB.id, connection.id)).rejects.toThrow(ForbiddenError);
    await expect(disconnectBankConnection(businessB.id, connection.id)).rejects.toThrow(ForbiddenError);
  });

  it("disconnectBankConnection marks the connection REVOKED and keeps historical data", async () => {
    const business = await createTestBusiness();
    const publicToken = await createSandboxPublicToken();
    const connection = await completeBankConnection(business.id, publicToken);
    await syncBankConnection(business.id, connection.id);

    await disconnectBankConnection(business.id, connection.id);

    const stored = await prisma.bankConnection.findUniqueOrThrow({ where: { id: connection.id } });
    expect(stored.status).toBe("REVOKED");

    // Accounts/transactions survive a disconnect -- not deleted.
    const list = await listBankConnections(business.id);
    const found = list.find((c) => c.id === connection.id);
    expect(found).toBeTruthy();
    expect(found!.accounts.length).toBeGreaterThan(0);

    const disconnectEntry = await prisma.auditLog.findFirst({
      where: { businessId: business.id, action: "bank.disconnect", entityId: connection.id },
    });
    expect(disconnectEntry).toBeTruthy();
  });
});

describe("bank connections module", () => {
  it("is exercised against real Plaid Sandbox only when PLAID_CLIENT_ID/PLAID_SECRET are set", () => {
    // A visible marker in the test output for why the suite above was
    // skipped, rather than a silent gap -- see describeIfConfigured above.
    if (!PLAID_CONFIGURED) {
      console.warn("PLAID_CLIENT_ID/PLAID_SECRET not set -- skipping real Plaid Sandbox integration tests.");
    }
    expect(true).toBe(true);
  });
});
