import { prisma } from "@/lib/db";

let counter = 0;
function uniqueSuffix() {
  counter += 1;
  return `${Date.now()}-${counter}`;
}

export async function createTestBusiness(name = "Test Business") {
  return prisma.business.create({ data: { name: `${name} ${uniqueSuffix()}` } });
}

export async function createTestUser(email?: string) {
  return prisma.user.create({
    data: {
      name: "Test User",
      email: email ?? `user-${uniqueSuffix()}@example.com`,
      passwordHash: "not-a-real-hash",
    },
  });
}

export async function createTestMembership(userId: string, businessId: string, role: "OWNER" | "MEMBER" = "OWNER") {
  return prisma.membership.create({ data: { userId, businessId, role, status: "ACTIVE" } });
}

export async function createTestCustomer(businessId: string, name = "Test Customer") {
  return prisma.customer.create({ data: { businessId, name: `${name} ${uniqueSuffix()}` } });
}

/** A bare BankConnection + one FinancialAccount, with no real Plaid call —
 * for tests that only need somewhere to hang a Transaction row (see
 * createTestTransaction), not the sync path itself (that's
 * bank-connections.test.ts, against real Plaid Sandbox). */
export async function createTestFinancialAccount(businessId: string) {
  const connection = await prisma.bankConnection.create({
    data: {
      businessId,
      provider: "plaid",
      providerItemId: `item-${uniqueSuffix()}`,
      accessTokenEncrypted: "not-a-real-token",
      institutionName: "Test Bank",
      accounts: {
        create: {
          businessId,
          providerAccountId: `acct-${uniqueSuffix()}`,
          name: "Test Checking",
          type: "depository",
        },
      },
    },
    include: { accounts: true },
  });
  return connection.accounts[0]!;
}

/** A synced Transaction row, as if it had come from a real sync — Plaid's
 * convention preserved (positive amountCents = money out, negative =
 * money in). */
export async function createTestTransaction(
  businessId: string,
  financialAccountId: string,
  overrides: Partial<{
    amountCents: number;
    merchantName: string | null;
    description: string;
    postedDate: Date;
  }> = {},
) {
  return prisma.transaction.create({
    data: {
      businessId,
      financialAccountId,
      providerTransactionId: `txn-${uniqueSuffix()}`,
      amountCents: overrides.amountCents ?? 1000,
      postedDate: overrides.postedDate ?? new Date(),
      merchantName: overrides.merchantName ?? "Test Merchant",
      description: overrides.description ?? "TEST MERCHANT PURCHASE",
    },
  });
}
