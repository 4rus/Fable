"use server";

import { revalidatePath } from "next/cache";
import { requireMembership, ForbiddenError } from "@/server/tenant";
import { parseExpenseCsv, commitExpenseImport, CsvParseError } from "@/server/services/csvImport";
import { commitCsvImportSchema, MAX_CSV_SIZE_BYTES } from "@/lib/validation/csvImport";
import { logError } from "@/lib/logger";

export interface PreviewRow {
  incurredAt: string; // ISO date, serializable through form state
  vendorName: string;
  amountCents: number;
}

export type PreviewState = {
  error?: string;
  preview?: {
    rows: PreviewRow[];
    skippedIncomeCount: number;
    skippedInvalidCount: number;
  };
};

export async function previewCsvImportAction(
  _prevState: PreviewState,
  formData: FormData,
): Promise<PreviewState> {
  const businessIdRaw = formData.get("businessId");
  const file = formData.get("file");

  if (typeof businessIdRaw !== "string") return { error: "Invalid request." };
  if (!(file instanceof File) || file.size === 0) {
    return { error: "Please choose a CSV file." };
  }
  if (file.size > MAX_CSV_SIZE_BYTES) {
    return { error: `That file is larger than the ${MAX_CSV_SIZE_BYTES / (1024 * 1024)}MB limit.` };
  }

  await requireMembership(businessIdRaw); // just needs to succeed; result unused here

  try {
    const text = await file.text();
    const result = parseExpenseCsv(text);
    return {
      preview: {
        rows: result.expenseRows.map((r) => ({
          incurredAt: r.incurredAt.toISOString(),
          vendorName: r.vendorName,
          amountCents: r.amountCents,
        })),
        skippedIncomeCount: result.skippedIncomeCount,
        skippedInvalidCount: result.skippedInvalidCount,
      },
    };
  } catch (err) {
    if (err instanceof CsvParseError) return { error: err.message };
    logError("previewCsvImport failed", err);
    return { error: "Could not read that file. Please try again." };
  }
}

export type CommitState = { error?: string; result?: { createdCount: number; duplicateCount: number } };

export async function commitCsvImportAction(
  _prevState: CommitState,
  formData: FormData,
): Promise<CommitState> {
  let rowsRaw: unknown;
  try {
    rowsRaw = JSON.parse(String(formData.get("rows") ?? "[]"));
  } catch {
    return { error: "Invalid row data." };
  }

  const parsed = commitCsvImportSchema.safeParse({
    businessId: formData.get("businessId"),
    categoryId: formData.get("categoryId"),
    rows: Array.isArray(rowsRaw)
      ? rowsRaw.map((r: PreviewRow) => ({
          incurredAt: r.incurredAt,
          vendorName: r.vendorName,
          amountCents: r.amountCents,
        }))
      : [],
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { businessId } = await requireMembership(parsed.data.businessId);

  try {
    const result = await commitExpenseImport({
      businessId,
      categoryId: parsed.data.categoryId,
      rows: parsed.data.rows,
    });
    revalidatePath("/app/expenses");
    revalidatePath("/app");
    return { result };
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    logError("commitCsvImport failed", err);
    return { error: "Could not import those expenses. Please try again." };
  }
}
