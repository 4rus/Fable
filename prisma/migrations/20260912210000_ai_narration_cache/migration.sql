-- CreateTable
CREATE TABLE "narrations" (
    "id" TEXT NOT NULL,
    "businessId" TEXT NOT NULL,
    "subjectKey" TEXT NOT NULL,
    "factsHash" TEXT NOT NULL,
    "fields" JSONB NOT NULL,
    "model" TEXT NOT NULL DEFAULT '',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "narrations_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "narrations_businessId_idx" ON "narrations"("businessId");

-- CreateIndex
CREATE UNIQUE INDEX "narrations_businessId_subjectKey_key" ON "narrations"("businessId", "subjectKey");

-- AddForeignKey
ALTER TABLE "narrations" ADD CONSTRAINT "narrations_businessId_fkey" FOREIGN KEY ("businessId") REFERENCES "businesses"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Same reasoning as the enable_rls migration: any new public table needs
-- RLS enabled explicitly, it is not automatic. ENABLE (not FORCE) so the
-- app's own Prisma connection (table owner) is unaffected; every other
-- role gets zero rows/writes.
-- Unqualified (not "public".narrations) — see the Phase C note in
-- 20260912201500_enable_rls/migration.sql for why a hardcoded schema
-- prefix here would silently target the wrong schema on a schema-scoped
-- deploy (e.g. a "production" schema instead of "public").
ALTER TABLE "narrations" ENABLE ROW LEVEL SECURITY;
