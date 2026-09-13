import { z } from "zod";

export const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — a bank statement CSV is never this large
export const MAX_CSV_ROWS = 2000;

export const parsedExpenseRowSchema = z.object({
  incurredAt: z.coerce.date(),
  vendorName: z.string().trim().min(1).max(200),
  // Same $10M sanity ceiling as every other money input in the app (see
  // the `cents` bound in validation/invoices.ts). Found by adversarial
  // testing (Phase P): a bank-statement CSV can contain arbitrary text in
  // its amount column, and without this bound a huge value parsed clean
  // through parseAmount()'s regex, then failed at the Prisma layer with a
  // Postgres 32-bit integer overflow — one bad row deep in an otherwise
  // valid multi-hundred-row batch, surfaced as a generic "Could not
  // import those expenses" with no indication of which row or that some
  // earlier rows in the same loop had already been committed
  // (commitExpenseImport inserts one row at a time, not in one
  // transaction). Rejecting the whole batch up front here, before any
  // row is ever inserted, is the actual fix — not a per-row try/catch
  // that would still leave a partially-imported batch to explain.
  amountCents: z.number().int().positive().max(1_000_000_000),
});

export const commitCsvImportSchema = z.object({
  businessId: z.string().min(1),
  categoryId: z.string().min(1),
  rows: z.array(parsedExpenseRowSchema).min(1).max(MAX_CSV_ROWS),
});
