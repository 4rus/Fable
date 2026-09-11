-- AlterTable
ALTER TABLE "expenses" ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "payments" ADD COLUMN     "transactionId" TEXT;

-- AlterTable
ALTER TABLE "transactions" DROP COLUMN "category",
ADD COLUMN     "categoryId" TEXT,
ADD COLUMN     "categorySource" TEXT,
ADD COLUMN     "ignoredAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "merchant_category_rules" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "merchantKey" TEXT NOT NULL,
    "categoryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "merchant_category_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "merchant_category_rules_businessId_idx" ON "merchant_category_rules"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "merchant_category_rules_businessId_merchantKey_key" ON "merchant_category_rules"("businessId", "merchantKey");

-- CreateIndex
CREATE UNIQUE INDEX "expenses_transactionId_key" ON "expenses"("transactionId");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transactionId_key" ON "payments"("transactionId");

-- CreateIndex
CREATE INDEX "transactions_categoryId_idx" ON "transactions"("categoryId");

-- AddForeignKey
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_category_rules" ADD CONSTRAINT "merchant_category_rules_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "merchant_category_rules" ADD CONSTRAINT "merchant_category_rules_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "categories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

