import "server-only";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { ForbiddenError } from "@/server/tenant";
import {
  isPlaidConfigured,
  createLinkToken as providerCreateLinkToken,
  exchangePublicToken,
  getConnectionInfo,
  syncTransactionsPage,
  removeItem,
} from "./plaidClient";
import { categorizeBySavedRule } from "./categorization";

/**
 * Provider-agnostic bank connectivity — the domain layer everything
 * outside src/server/services/bank/ should call. No Plaid-specific type
 * or concept crosses this boundary; see plaidClient.ts and the
 * schema.prisma comment above BankConnection for the full reasoning.
 *
 * Every function here takes a businessId and scopes its queries by it —
 * the same tenant-safety convention as the rest of the app (see
 * src/server/tenant.ts) — even though callers (server actions) already
 * call requireMembership() first. Defense in depth: a connectionId from
 * the URL/form is still treated as an unauthenticated candidate to check,
 * never as ground truth.
 */

export class ProviderNotConfiguredError extends Error {
  constructor() {
    super("Bank connectivity isn't configured in this environment yet.");
    this.name = "ProviderNotConfiguredError";
  }
}

/** Starts a Plaid Link session for the given user. Not business-scoped —
 * Link itself doesn't know which business the resulting connection will
 * belong to until completeBankConnection() runs; that's where the real
 * tenant check happens. */
export async function startBankConnection(userId: string): Promise<{ linkToken: string }> {
  if (!isPlaidConfigured()) throw new ProviderNotConfiguredError();
  const linkToken = await providerCreateLinkToken(userId);
  return { linkToken };
}

/**
 * Exchanges Link's public_token, fetches the connected accounts, and
 * persists everything: the access token (encrypted), the connection
 * row, and one FinancialAccount row per account Plaid returned. Runs in
 * a transaction so a failure partway through never leaves an
 * unencrypted token or an orphaned connection with no accounts.
 */
export async function completeBankConnection(businessId: string, publicToken: string) {
  if (!isPlaidConfigured()) throw new ProviderNotConfiguredError();

  const { accessToken, itemId } = await exchangePublicToken(publicToken);
  const info = await getConnectionInfo(accessToken);

  return prisma.$transaction(async (tx) => {
    const connection = await tx.bankConnection.create({
      data: {
        businessId,
        provider: "plaid",
        providerItemId: itemId,
        accessTokenEncrypted: encrypt(accessToken),
        institutionId: info.institutionId,
        institutionName: info.institutionName,
        status: "ACTIVE",
        accounts: {
          create: info.accounts.map((a) => ({
            businessId,
            providerAccountId: a.providerAccountId,
            name: a.name,
            mask: a.mask,
            type: a.type,
            subtype: a.subtype,
            currentBalanceCents: a.currentBalanceCents,
            availableBalanceCents: a.availableBalanceCents,
            isoCurrencyCode: a.isoCurrencyCode,
          })),
        },
      },
      include: { accounts: true },
    });

    await tx.auditLog.create({
      data: {
        businessId,
        action: "bank.connect",
        entityType: "BankConnection",
        entityId: connection.id,
        metadata: JSON.stringify({ institutionName: info.institutionName, accountCount: info.accounts.length }),
      },
    });

    return connection;
  });
}

/** Lists connections for a business — never includes accessTokenEncrypted;
 * callers (pages/components) should never need it. */
export async function listBankConnections(businessId: string) {
  return prisma.bankConnection.findMany({
    where: { businessId },
    select: {
      id: true,
      provider: true,
      institutionId: true,
      institutionName: true,
      status: true,
      errorCode: true,
      lastSyncedAt: true,
      createdAt: true,
      accounts: {
        select: {
          id: true,
          name: true,
          mask: true,
          type: true,
          subtype: true,
          currentBalanceCents: true,
          isoCurrencyCode: true,
        },
      },
    },
    orderBy: { createdAt: "desc" },
  });
}

async function getOwnedConnection(businessId: string, connectionId: string) {
  const connection = await prisma.bankConnection.findFirst({
    where: { id: connectionId, businessId },
  });
  if (!connection) throw new ForbiddenError("Bank connection not found for this business");
  return connection;
}

/** Disconnects a bank connection: best-effort revoke at the provider
 * (a failure there — e.g. already revoked on their end — doesn't block
 * the user from disconnecting locally), then marks REVOKED. Historical
 * transactions/accounts are kept, not deleted, so past insights and the
 * audit trail stay intact. */
export async function disconnectBankConnection(businessId: string, connectionId: string): Promise<void> {
  const connection = await getOwnedConnection(businessId, connectionId);

  try {
    await removeItem(decrypt(connection.accessTokenEncrypted));
  } catch {
    // Best-effort — proceed to mark it revoked locally regardless.
  }

  await prisma.$transaction([
    prisma.bankConnection.update({
      where: { id: connection.id },
      data: { status: "REVOKED" },
    }),
    prisma.auditLog.create({
      data: {
        businessId,
        action: "bank.disconnect",
        entityType: "BankConnection",
        entityId: connection.id,
      },
    }),
  ]);
}

export interface SyncResult {
  addedCount: number;
  modifiedCount: number;
  removedCount: number;
}

/**
 * Full incremental sync for one connection: pages through Plaid's
 * transactions/sync until has_more is false, upserting by
 * providerTransactionId (the stable identity — never inserts a
 * duplicate for a transaction already seen), and persists the cursor
 * after EVERY page so a crash mid-sync resumes from where it left off
 * on the next run instead of reprocessing everything or losing the
 * cursor entirely.
 */
export async function syncBankConnection(businessId: string, connectionId: string): Promise<SyncResult> {
  const connection = await getOwnedConnection(businessId, connectionId);
  if (connection.status !== "ACTIVE") {
    throw new ForbiddenError(`Cannot sync a connection with status ${connection.status}`);
  }

  const accessToken = decrypt(connection.accessTokenEncrypted);
  const accountsByProviderId = new Map(
    (await prisma.financialAccount.findMany({ where: { bankConnectionId: connection.id } })).map((a) => [
      a.providerAccountId,
      a.id,
    ]),
  );

  let cursor = connection.transactionsCursor;
  let addedCount = 0;
  let modifiedCount = 0;
  let removedCount = 0;
  let hasMore = true;

  while (hasMore) {
    const page = await syncTransactionsPage(accessToken, cursor);

    for (const t of [...page.added, ...page.modified]) {
      const financialAccountId = accountsByProviderId.get(t.providerAccountId);
      if (!financialAccountId) continue; // account not tracked on this connection (shouldn't happen; skip defensively rather than throw mid-sync)

      // High-confidence categorization ONLY (a rule this business itself
      // taught us — see categorization.ts) is applied automatically, and
      // ONLY in the `create` branch below: it must never overwrite a
      // category the user already set by hand on an update pass.
      const autoCategory = await categorizeBySavedRule(businessId, t.merchantName, t.description);

      await prisma.transaction.upsert({
        where: { providerTransactionId: t.providerTransactionId },
        create: {
          businessId,
          financialAccountId,
          providerTransactionId: t.providerTransactionId,
          amountCents: t.amountCents,
          isoCurrencyCode: t.isoCurrencyCode,
          postedDate: t.postedDate,
          authorizedDate: t.authorizedDate,
          merchantName: t.merchantName,
          description: t.description,
          pending: t.pending,
          providerCategory: t.providerCategory,
          categoryId: autoCategory?.categoryId,
          categorySource: autoCategory?.source,
        },
        update: {
          amountCents: t.amountCents,
          postedDate: t.postedDate,
          authorizedDate: t.authorizedDate,
          merchantName: t.merchantName,
          description: t.description,
          pending: t.pending,
          providerCategory: t.providerCategory,
          deletedAt: null,
        },
      });
    }
    addedCount += page.added.length;
    modifiedCount += page.modified.length;

    if (page.removedProviderTransactionIds.length > 0) {
      const result = await prisma.transaction.updateMany({
        where: { businessId, providerTransactionId: { in: page.removedProviderTransactionIds } },
        data: { deletedAt: new Date() },
      });
      removedCount += result.count;
    }

    cursor = page.nextCursor;
    hasMore = page.hasMore;

    // Persist the cursor after every page, not just at the end — a crash
    // here still leaves the next sync resuming from real progress.
    await prisma.bankConnection.update({
      where: { id: connection.id },
      data: { transactionsCursor: cursor },
    });
  }

  await prisma.bankConnection.update({
    where: { id: connection.id },
    data: { lastSyncedAt: new Date() },
  });

  if (addedCount + modifiedCount + removedCount > 0) {
    await prisma.auditLog.create({
      data: {
        businessId,
        action: "bank.sync",
        entityType: "BankConnection",
        entityId: connection.id,
        metadata: JSON.stringify({ addedCount, modifiedCount, removedCount }),
      },
    });
  }

  return { addedCount, modifiedCount, removedCount };
}

/**
 * Read-only list of synced transactions for display
 * (src/app/app/bank/page.tsx, the "Recent activity" feed). Categorization
 * and reconciliation into Expense/Payment rows (Phase G) happen elsewhere
 * — see src/server/services/bank/categorization.ts and reconciliation.ts,
 * and the "Needs attention" review list built on top of them. This
 * function stays deliberately dumb: real evidence that syncing worked,
 * nothing more.
 */
export async function listRecentTransactions(businessId: string, limit = 50) {
  return prisma.transaction.findMany({
    where: { businessId, deletedAt: null },
    select: {
      id: true,
      amountCents: true,
      isoCurrencyCode: true,
      postedDate: true,
      merchantName: true,
      description: true,
      pending: true,
      providerCategory: true,
      category: { select: { name: true } },
      financialAccount: { select: { name: true, mask: true } },
    },
    orderBy: { postedDate: "desc" },
    take: limit,
  });
}
