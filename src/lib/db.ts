import { PrismaClient } from "@prisma/client";

// Standard Next.js dev-mode singleton so hot-reload doesn't open a new
// Prisma connection pool on every file save.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["warn", "error"] : ["error"],
    // Prisma's default interactive-transaction timeout (5000ms) assumes a
    // low-latency local database. We run against a real, remote Postgres
    // (Supabase's Supavisor pooler) from every environment, including
    // dev — several sequential queries inside one $transaction (e.g.
    // recordPayment, confirmExpenseFromTransaction) can legitimately
    // exceed 5s of real network round-trips without anything being wrong.
    // 20s gives real multi-query financial transactions room to complete
    // under realistic latency without masking an actual hang (still well
    // under any user-facing request timeout).
    transactionOptions: { timeout: 20_000 },
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
