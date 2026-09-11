-- CreateTable
CREATE TABLE "bank_connections" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'plaid',
    "providerItemId" TEXT NOT NULL,
    "accessTokenEncrypted" TEXT NOT NULL,
    "institutionId" TEXT,
    "institutionName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "errorCode" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "transactionsCursor" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bank_connections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_accounts" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "bankConnectionId" TEXT NOT NULL,
    "providerAccountId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "mask" TEXT,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "currentBalanceCents" INTEGER,
    "availableBalanceCents" INTEGER,
    "isoCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transactions" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "financialAccountId" TEXT NOT NULL,
    "providerTransactionId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "isoCurrencyCode" TEXT NOT NULL DEFAULT 'USD',
    "postedDate" TIMESTAMP(3) NOT NULL,
    "authorizedDate" TIMESTAMP(3),
    "merchantName" TEXT,
    "description" TEXT NOT NULL,
    "pending" BOOLEAN NOT NULL DEFAULT false,
    "category" TEXT,
    "providerCategory" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "transactions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "bank_connections_providerItemId_key" ON "bank_connections"("providerItemId");

-- CreateIndex
CREATE INDEX "bank_connections_businessId_idx" ON "bank_connections"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "financial_accounts_providerAccountId_key" ON "financial_accounts"("providerAccountId");

-- CreateIndex
CREATE INDEX "financial_accounts_businessId_idx" ON "financial_accounts"("businessId");

-- CreateIndex
CREATE INDEX "financial_accounts_bankConnectionId_idx" ON "financial_accounts"("bankConnectionId");

-- CreateIndex
CREATE UNIQUE INDEX "transactions_providerTransactionId_key" ON "transactions"("providerTransactionId");

-- CreateIndex
CREATE INDEX "transactions_businessId_postedDate_idx" ON "transactions"("businessId", "postedDate");

-- CreateIndex
CREATE INDEX "transactions_financialAccountId_idx" ON "transactions"("financialAccountId");

-- AddForeignKey
ALTER TABLE "bank_connections" ADD CONSTRAINT "bank_connections_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_accounts" ADD CONSTRAINT "financial_accounts_bankConnectionId_fkey" FOREIGN KEY ("bankConnectionId") REFERENCES "bank_connections"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_financialAccountId_fkey" FOREIGN KEY ("financialAccountId") REFERENCES "financial_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
