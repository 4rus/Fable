"use server";

import { revalidatePath } from "next/cache";
import { requireMembership, ForbiddenError } from "@/server/tenant";
import { logError } from "@/lib/logger";
import {
  categorizeTransactionSchema,
  matchInvoicePaymentSchema,
  ignoreTransactionSchema,
} from "@/lib/validation/bankReview";
import { confirmExpenseFromTransaction, confirmInvoicePayment, ignoreTransaction, InvalidTransactionError, TransactionReconciledError } from "@/server/services/bank/reconciliation";
import { OverpaymentError, InvalidInvoiceStateError } from "@/server/services/invoices";

export type BankReviewActionState = { error?: string };

/**
 * Confirms an outgoing transaction as an Expense under the given
 * category. One action does both "pick a category" and "confirm" in a
 * single step (the review UI defaults the category picker to any
 * suggestion, but the user can change it first) — see
 * confirmExpenseFromTransaction() for the actual reconciliation +
 * category-learning logic.
 */
export async function reconcileExpenseAction(
  businessId: string,
  transactionId: string,
  categoryId: string,
): Promise<BankReviewActionState> {
  const parsed = categorizeTransactionSchema.safeParse({ businessId, transactionId, categoryId });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { businessId: verifiedBusinessId } = await requireMembership(parsed.data.businessId);
  try {
    await confirmExpenseFromTransaction(verifiedBusinessId, parsed.data.transactionId, parsed.data.categoryId);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof InvalidTransactionError) return { error: err.message };
    logError("confirmExpenseFromTransaction failed", err);
    return { error: "Could not add this as an expense. Please try again." };
  }

  revalidatePath("/app/bank");
  revalidatePath("/app/expenses");
  revalidatePath("/app");
  return {};
}

/** Confirms a suggested (or manually picked) deposit -> invoice match,
 * recording the payment via the existing recordPayment() service. */
export async function matchInvoicePaymentAction(
  businessId: string,
  transactionId: string,
  invoiceId: string,
): Promise<BankReviewActionState> {
  const parsed = matchInvoicePaymentSchema.safeParse({ businessId, transactionId, invoiceId });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { businessId: verifiedBusinessId } = await requireMembership(parsed.data.businessId);
  try {
    await confirmInvoicePayment(verifiedBusinessId, parsed.data.transactionId, parsed.data.invoiceId);
  } catch (err) {
    if (
      err instanceof ForbiddenError ||
      err instanceof InvalidTransactionError ||
      err instanceof OverpaymentError ||
      err instanceof InvalidInvoiceStateError
    ) {
      return { error: err.message };
    }
    logError("confirmInvoicePayment failed", err);
    return { error: "Could not record this payment. Please try again." };
  }

  revalidatePath("/app/bank");
  revalidatePath("/app/invoices");
  revalidatePath("/app");
  return {};
}

/** Marks a transaction as ignored — not a business expense, or an internal
 * transfer — removing it from the review queue for good. */
export async function ignoreTransactionAction(
  businessId: string,
  transactionId: string,
): Promise<BankReviewActionState> {
  const parsed = ignoreTransactionSchema.safeParse({ businessId, transactionId });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { businessId: verifiedBusinessId } = await requireMembership(parsed.data.businessId);
  try {
    await ignoreTransaction(verifiedBusinessId, parsed.data.transactionId);
  } catch (err) {
    if (err instanceof ForbiddenError || err instanceof TransactionReconciledError) return { error: err.message };
    logError("ignoreTransaction failed", err);
    return { error: "Could not update this transaction. Please try again." };
  }

  revalidatePath("/app/bank");
  return {};
}
