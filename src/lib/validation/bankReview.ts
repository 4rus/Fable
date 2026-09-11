import { z } from "zod";

/** Inputs for the /app/bank "Needs attention" review actions — see
 * src/server/actions/bankReview.ts. All IDs here are treated as
 * unauthenticated candidates; every action re-checks tenant ownership in
 * the service layer, never trusts these on their own. */

export const categorizeTransactionSchema = z.object({
  businessId: z.string().min(1),
  transactionId: z.string().min(1),
  categoryId: z.string().min(1),
});

export const matchInvoicePaymentSchema = z.object({
  businessId: z.string().min(1),
  transactionId: z.string().min(1),
  invoiceId: z.string().min(1),
});

export const ignoreTransactionSchema = z.object({
  businessId: z.string().min(1),
  transactionId: z.string().min(1),
});
