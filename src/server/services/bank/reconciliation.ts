import "server-only";
import { prisma } from "@/lib/db";
import { ForbiddenError } from "@/server/tenant";
import { recordPayment, balanceDueCents } from "@/server/services/invoices";
import { suggestCategoryForTransaction, applyManualCategory, merchantKeyFor } from "./categorization";

/**
 * TRANSACTION RECONCILIATION (Phase G). Turns a synced Transaction into a
 * real Expense (outgoing) or a real Payment against an invoice (incoming)
 * — but ONLY on explicit user confirmation. Nothing in this file ever
 * creates an Expense or Payment on its own; see /app/bank's "Needs
 * attention" review list for the only UI path that calls these.
 *
 * IDEMPOTENCY: both Expense.transactionId and Payment.transactionId carry
 * a DB-level @unique constraint, so "reconcile the same transaction
 * twice" is impossible by construction, not just by a check in this file.
 * Both confirm* functions below still check first and return the existing
 * row on a repeat call, so a UI double-click or retried request is a
 * no-op rather than an error.
 */

export class TransactionReconciledError extends Error {
  constructor(message = "This transaction has already been reconciled") {
    super(message);
    this.name = "TransactionReconciledError";
  }
}

export class InvalidTransactionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidTransactionError";
  }
}

async function getOwnedTransaction(businessId: string, transactionId: string) {
  // Full expense/payment rows (not just an id) so the idempotent early
  // return in each confirm* function below matches the same shape the
  // non-idempotent path returns — callers get one consistent type either
  // way, not a union of "just an id" vs. "the full row".
  const transaction = await prisma.transaction.findFirst({
    where: { id: transactionId, businessId, deletedAt: null },
    include: { expense: true, payment: true },
  });
  if (!transaction) throw new ForbiddenError("Transaction not found for this business");
  return transaction;
}

/**
 * Creates an Expense from an outgoing (amountCents > 0, Plaid convention)
 * Transaction. `categoryId` is always required here — the caller (server
 * action) is responsible for making sure the review UI never lets this be
 * called without one selected, matching the "never guess" rule; this
 * function also (re)applies the category to the transaction and learns
 * the merchant rule, exactly like a manual category pick, so a bulk
 * "review & import" flow teaches Fable the same way a single confirm does.
 */
export async function confirmExpenseFromTransaction(
  businessId: string,
  transactionId: string,
  categoryId: string,
) {
  const transaction = await getOwnedTransaction(businessId, transactionId);
  if (transaction.expense) return transaction.expense; // idempotent no-op
  if (transaction.ignoredAt) throw new InvalidTransactionError("This transaction was marked as ignored");
  if (transaction.amountCents <= 0) {
    throw new InvalidTransactionError("Only an outgoing transaction (money out) can become an expense");
  }

  const category = await prisma.category.findFirst({
    where: { id: categoryId, businessId, type: "EXPENSE" },
    select: { id: true },
  });
  if (!category) throw new ForbiddenError("Invalid category for this business");

  const merchantKey = merchantKeyFor(transaction.merchantName, transaction.description);

  return prisma.$transaction(async (tx) => {
    // Re-check for a race: two concurrent confirms for the same
    // transaction. The @unique constraint on Expense.transactionId is the
    // real guarantee; this just turns the race into a clean idempotent
    // return instead of a thrown Prisma unique-violation.
    const existing = await tx.expense.findUnique({ where: { transactionId } });
    if (existing) return existing;

    const expense = await tx.expense.create({
      data: {
        businessId,
        categoryId,
        vendorName: transaction.merchantName ?? transaction.description,
        amountCents: transaction.amountCents,
        incurredAt: transaction.postedDate,
        description: "Reconciled from bank transaction",
        transactionId,
      },
    });

    // Same "manual pick learns a rule" behavior a standalone category
    // pick gets — see categorization.ts.
    await applyManualCategory(tx, businessId, transactionId, categoryId, merchantKey);

    await tx.auditLog.create({
      data: {
        businessId,
        action: "transaction.reconcile_expense",
        entityType: "Expense",
        entityId: expense.id,
        metadata: JSON.stringify({ transactionId, amountCents: transaction.amountCents }),
      },
    });

    return expense;
  });
}

/** Marks a transaction as ignored (not a business expense, an internal
 * transfer, etc.) — excluded from the review queue, never reconciled. */
export async function ignoreTransaction(businessId: string, transactionId: string): Promise<void> {
  const transaction = await getOwnedTransaction(businessId, transactionId);
  if (transaction.expense || transaction.payment) {
    throw new TransactionReconciledError("This transaction is already reconciled — it can't be ignored");
  }
  await prisma.transaction.update({ where: { id: transactionId }, data: { ignoredAt: new Date() } });
}

export interface InvoiceMatchCandidate {
  invoiceId: string;
  invoiceNumber: string;
  customerName: string;
  balanceDueCents: number;
}

/**
 * Looks for exactly one plausible open invoice for an incoming (deposit)
 * transaction: the deposit amount must equal that invoice's remaining
 * balance exactly (never a fuzzy amount match — money math is never
 * approximate here), and it should be corroborated by either date
 * proximity to the invoice's issue/due date OR the customer's name
 * appearing in the transaction's own description. If more than one open
 * invoice matches on amount, or none is corroborated, this returns null —
 * an ambiguous or unconvincing candidate is the same as no candidate: the
 * user decides, we never guess.
 */
export async function findInvoiceMatch(
  businessId: string,
  transaction: { amountCents: number; postedDate: Date; merchantName: string | null; description: string },
): Promise<InvoiceMatchCandidate | null> {
  if (transaction.amountCents >= 0) return null; // not a deposit

  const depositCents = -transaction.amountCents;
  const openInvoices = await prisma.invoice.findMany({
    where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID"] }, deletedAt: null },
    include: { payments: { where: { voidedAt: null } }, customer: true },
  });

  const amountMatches = openInvoices.filter((inv) => balanceDueCents(inv) === depositCents);
  if (amountMatches.length !== 1) return null; // none, or ambiguous — don't guess

  const invoice = amountMatches[0]!;
  const haystack = `${transaction.merchantName ?? ""} ${transaction.description}`.toLowerCase();
  const nameMatches = haystack.includes(invoice.customer.name.toLowerCase().split(" ")[0] ?? "");

  const DAY_MS = 24 * 60 * 60 * 1000;
  const dateProximityMs = Math.min(
    Math.abs(transaction.postedDate.getTime() - invoice.issueDate.getTime()),
    Math.abs(transaction.postedDate.getTime() - invoice.dueDate.getTime()),
  );
  const dateMatches = dateProximityMs <= 21 * DAY_MS;

  if (!nameMatches && !dateMatches) return null; // amount alone isn't enough corroboration

  return {
    invoiceId: invoice.id,
    invoiceNumber: invoice.number,
    customerName: invoice.customer.name,
    balanceDueCents: balanceDueCents(invoice),
  };
}

/**
 * Confirms a suggested (or manually picked) invoice match: records the
 * payment via the EXISTING recordPayment() — reusing its overpayment
 * guard, idempotency, and status-transition logic rather than
 * duplicating any of it — then links the Payment back to the source
 * Transaction. The idempotency key is deterministic
 * (`bank-txn:<transactionId>`), so recordPayment() itself refuses to
 * double-record even if this function is somehow invoked twice
 * concurrently before the transactionId link below lands.
 */
export async function confirmInvoicePayment(businessId: string, transactionId: string, invoiceId: string) {
  const transaction = await getOwnedTransaction(businessId, transactionId);
  if (transaction.payment) return transaction.payment; // idempotent no-op
  if (transaction.ignoredAt) throw new InvalidTransactionError("This transaction was marked as ignored");
  if (transaction.amountCents >= 0) {
    throw new InvalidTransactionError("Only an incoming transaction (money in) can be matched to an invoice");
  }

  const idempotencyKey = `bank-txn:${transactionId}`;
  await recordPayment({
    businessId,
    invoiceId,
    amountCents: -transaction.amountCents,
    method: "bank_transfer",
    paidAt: transaction.postedDate,
    note: "Matched from bank transaction",
    idempotencyKey,
  });

  const payment = await prisma.payment.findUniqueOrThrow({ where: { idempotencyKey } });
  if (payment.transactionId) return payment;
  return prisma.payment.update({ where: { id: payment.id }, data: { transactionId } });
}

export type ReviewItem =
  | {
      type: "expense";
      transaction: {
        id: string;
        amountCents: number;
        isoCurrencyCode: string;
        postedDate: Date;
        merchantName: string | null;
        description: string;
      };
      currentCategory: { id: string; name: string } | null;
      suggestedCategory: { id: string; name: string } | null;
    }
  | {
      type: "deposit";
      transaction: {
        id: string;
        amountCents: number;
        isoCurrencyCode: string;
        postedDate: Date;
        merchantName: string | null;
        description: string;
      };
      suggestedInvoice: InvoiceMatchCandidate | null;
    };

/**
 * The "Needs attention" list: every synced, non-deleted, non-ignored
 * transaction that hasn't been reconciled yet, split into outgoing
 * (candidate expenses) and incoming (candidate invoice payments), each
 * carrying whatever suggestion (if any) the review UI can offer for a
 * one-click confirm. Nothing here is written to the database — it's all
 * computed live so the list always reflects the current state of
 * invoices/categories.
 */
export async function listTransactionsNeedingReview(businessId: string, limit = 100): Promise<ReviewItem[]> {
  const transactions = await prisma.transaction.findMany({
    where: { businessId, deletedAt: null, ignoredAt: null, expense: null, payment: null },
    include: { category: { select: { id: true, name: true } } },
    orderBy: { postedDate: "desc" },
    take: limit,
  });

  const items: ReviewItem[] = [];
  for (const t of transactions) {
    if (t.amountCents > 0) {
      const suggested = t.categoryId
        ? null
        : await suggestCategoryForTransaction(businessId, t.merchantName, t.description);
      items.push({
        type: "expense",
        transaction: {
          id: t.id,
          amountCents: t.amountCents,
          isoCurrencyCode: t.isoCurrencyCode,
          postedDate: t.postedDate,
          merchantName: t.merchantName,
          description: t.description,
        },
        currentCategory: t.category,
        suggestedCategory: suggested
          ? { id: suggested.categoryId, name: suggested.categoryName }
          : null,
      });
    } else {
      const suggestedInvoice = await findInvoiceMatch(businessId, t);
      items.push({
        type: "deposit",
        transaction: {
          id: t.id,
          amountCents: t.amountCents,
          isoCurrencyCode: t.isoCurrencyCode,
          postedDate: t.postedDate,
          merchantName: t.merchantName,
          description: t.description,
        },
        suggestedInvoice,
      });
    }
  }
  return items;
}

/** Total count of open review items — cheap enough for a nav badge without
 * pulling in the full suggestion computation above. */
export async function countTransactionsNeedingReview(businessId: string): Promise<number> {
  return prisma.transaction.count({
    where: { businessId, deletedAt: null, ignoredAt: null, expense: null, payment: null },
  });
}
