import { z } from "zod";

export const MAX_CSV_SIZE_BYTES = 2 * 1024 * 1024; // 2MB — a bank statement CSV is never this large
export const MAX_CSV_ROWS = 2000;

export const parsedExpenseRowSchema = z.object({
  incurredAt: z.coerce.date(),
  vendorName: z.string().trim().min(1).max(200),
  amountCents: z.number().int().positive(),
});

export const commitCsvImportSchema = z.object({
  businessId: z.string().min(1),
  categoryId: z.string().min(1),
  rows: z.array(parsedExpenseRowSchema).min(1).max(MAX_CSV_ROWS),
});
