import "server-only";
import { prisma } from "@/lib/db";
import type { Prisma } from "@prisma/client";

/**
 * TRANSACTION CATEGORIZATION (Phase G).
 *
 * "Never guess silently" — the same rule csvImport.ts documents for CSV
 * rows applies here. There are exactly two ways a Transaction.categoryId
 * gets written:
 *
 *  1. MERCHANT RULE (high confidence, auto-applied at sync time): this
 *     business has previously categorized a transaction from the same
 *     normalized merchant, so we already know the answer — see
 *     MerchantCategoryRule in prisma/schema.prisma.
 *  2. MANUAL (the user picked it, or confirmed a suggestion): always
 *     learns a new/updated MerchantCategoryRule so the same merchant
 *     never has to be asked about again.
 *
 * A generic keyword match (`suggestCategoryForTransaction`) is NEVER
 * written to the database on its own — it's a live suggestion the review
 * UI can offer, and only becomes real once a human confirms it (at which
 * point it goes through path 2 above, same as any other manual pick).
 */

export type CategorySource = "merchant_rule" | "manual";

/** Generic, deterministic merchant/description keyword -> category name
 * hints. Matched only against category NAMES that already exist for the
 * business (see DEFAULT_CATEGORIES in src/server/services/businesses.ts) —
 * this never invents a category, and never applies if the business
 * doesn't have a matching one. Order matters: first match wins. */
const KEYWORD_RULES: { pattern: RegExp; categoryName: string }[] = [
  { pattern: /\b(aws|amazon web services|google cloud|microsoft azure|vercel|github|slack|zoom|dropbox|notion|adobe|quickbooks|figma)\b/i, categoryName: "Software & Subscriptions" },
  { pattern: /\b(shell|chevron|exxon|texaco|bp gas|gas station|fuel)\b/i, categoryName: "Vehicle & Fuel" },
  { pattern: /\b(geico|progressive|state farm|allstate|insurance)\b/i, categoryName: "Insurance" },
  { pattern: /\b(facebook ads|meta ads|google ads|instagram ads|mailchimp|constant contact)\b/i, categoryName: "Marketing" },
  { pattern: /\b(gusto|adp payroll|paychex|rippling)\b/i, categoryName: "Payroll & Contractors" },
  { pattern: /\b(rent|property management|leasing)\b/i, categoryName: "Rent" },
  { pattern: /\b(staples|office depot|costco|home depot|lowes)\b/i, categoryName: "Supplies" },
];

/** Normalizes a merchant name / raw description into a stable key: lower-
 * cased, punctuation and digit runs (store numbers, card-network suffixes
 * like "SQ *" or "#1234") stripped, whitespace collapsed. Deterministic and
 * pure — the same merchant should always normalize to the same key so a
 * learned rule keeps matching it. */
export function normalizeMerchantKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/\b\d{3,}\b/g, " ") // long digit runs (store #s, order #s)
    .replace(/[^a-z0-9 ]/g, " ") // punctuation
    .replace(/\s+/g, " ")
    .trim();
}

export function merchantKeyFor(merchantName: string | null, description: string): string {
  return normalizeMerchantKey(merchantName || description);
}

/**
 * Writes a manual category assignment plus the merchant rule it teaches,
 * within a caller-supplied transaction client — the building block both
 * setTransactionCategory() (below) and confirmExpenseFromTransaction()
 * (reconciliation.ts, which needs this atomic with the Expense insert)
 * are built on, so the "manual pick learns a rule" behavior can never
 * drift between the two call sites.
 */
export async function applyManualCategory(
  tx: Prisma.TransactionClient,
  businessId: string,
  transactionId: string,
  categoryId: string,
  merchantKey: string,
): Promise<void> {
  await tx.transaction.update({
    where: { id: transactionId },
    data: { categoryId, categorySource: "manual" satisfies CategorySource },
  });

  if (merchantKey) {
    await tx.merchantCategoryRule.upsert({
      where: { businessId_merchantKey: { businessId, merchantKey } },
      create: { businessId, merchantKey, categoryId },
      update: { categoryId },
    });
  }
}

/** High-confidence categorization for use at sync time: only ever a
 * merchant rule this business itself created. Returns null (never a
 * guess) if no rule exists yet. */
export async function categorizeBySavedRule(
  businessId: string,
  merchantName: string | null,
  description: string,
): Promise<{ categoryId: string; source: "merchant_rule" } | null> {
  const merchantKey = merchantKeyFor(merchantName, description);
  if (!merchantKey) return null;

  const rule = await prisma.merchantCategoryRule.findUnique({
    where: { businessId_merchantKey: { businessId, merchantKey } },
    select: { categoryId: true },
  });
  if (!rule) return null;
  return { categoryId: rule.categoryId, source: "merchant_rule" };
}

/** Low-confidence, generic keyword suggestion for the review UI — never
 * persisted on its own. Only offered when the business already has an
 * EXPENSE category with that exact name (never invents one). */
export async function suggestCategoryForTransaction(
  businessId: string,
  merchantName: string | null,
  description: string,
): Promise<{ categoryId: string; categoryName: string } | null> {
  const haystack = `${merchantName ?? ""} ${description}`;
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(haystack)) {
      const category = await prisma.category.findFirst({
        where: { businessId, name: rule.categoryName, type: "EXPENSE" },
        select: { id: true, name: true },
      });
      if (category) return { categoryId: category.id, categoryName: category.name };
    }
  }
  return null;
}

/**
 * Sets a transaction's category by hand (a user pick, or a confirmed
 * suggestion) and learns/updates the merchant rule so future transactions
 * from the same merchant categorize automatically. Tenant-scoped: a
 * transactionId/categoryId from another business fails here even if the
 * caller forgot to check membership.
 */
export async function setTransactionCategory(
  businessId: string,
  transactionId: string,
  categoryId: string,
): Promise<void> {
  const [transaction, category] = await Promise.all([
    prisma.transaction.findFirst({
      where: { id: transactionId, businessId, deletedAt: null },
      select: { id: true, merchantName: true, description: true },
    }),
    prisma.category.findFirst({ where: { id: categoryId, businessId, type: "EXPENSE" }, select: { id: true } }),
  ]);
  if (!transaction) throw new Error("Transaction not found for this business");
  if (!category) throw new Error("Invalid category for this business");

  const merchantKey = merchantKeyFor(transaction.merchantName, transaction.description);

  await prisma.$transaction((tx) => applyManualCategory(tx, businessId, transactionId, categoryId, merchantKey));
}
