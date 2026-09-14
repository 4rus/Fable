"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { logError } from "@/lib/logger";
import { requireMembership, ForbiddenError } from "@/server/tenant";
import { createExpenseSchema } from "@/lib/validation/invoices";
import { uploadAttachment, InvalidFileError } from "@/server/services/attachments";

export type ActionState = { error?: string };

export async function createExpenseAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createExpenseSchema.safeParse({
    businessId: formData.get("businessId"),
    categoryId: formData.get("categoryId"),
    vendorName: formData.get("vendorName"),
    amountCents: Math.round(Number(formData.get("amountDollars") ?? 0) * 100),
    incurredAt: formData.get("incurredAt"),
    description: formData.get("description"),
    isRecurring: formData.get("isRecurring") === "on",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { businessId, userId } = await requireMembership(parsed.data.businessId);

  // Tenant check on the category too — a categoryId from another business
  // must not be usable here even if someone forged the form field.
  const category = await prisma.category.findFirst({
    where: { id: parsed.data.categoryId, businessId },
  });
  if (!category) return { error: "Invalid category for this business" };

  let expenseId: string;
  try {
    const expense = await prisma.expense.create({
      data: {
        businessId,
        categoryId: parsed.data.categoryId,
        vendorName: parsed.data.vendorName,
        amountCents: parsed.data.amountCents,
        incurredAt: parsed.data.incurredAt,
        description: parsed.data.description || null,
        isRecurring: parsed.data.isRecurring,
      },
    });
    expenseId = expense.id;
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    logError("createExpense failed", err);
    return { error: "Could not save the expense. Please try again." };
  }

  // Optional: a receipt photo carried over from the "Scan a receipt" flow
  // (or attached manually alongside a hand-entered expense). Best-effort —
  // the expense itself is already saved by this point, so a failed
  // attachment upload is reported but doesn't undo it; the user can still
  // add the receipt afterward from the expense row like any other upload.
  const receiptFile = formData.get("receiptFile");
  if (receiptFile instanceof File && receiptFile.size > 0) {
    try {
      const buffer = Buffer.from(await receiptFile.arrayBuffer());
      await uploadAttachment({
        businessId,
        expenseId,
        filename: receiptFile.name,
        buffer,
        uploadedByUserId: userId,
      });
    } catch (err) {
      revalidatePath("/app/expenses");
      revalidatePath("/app");
      if (err instanceof InvalidFileError) {
        return { error: `Expense saved, but the receipt photo couldn't be attached: ${err.message}` };
      }
      logError("receipt attachment upload failed after expense create", err);
      return { error: "Expense saved, but the receipt photo couldn't be attached. You can add it below." };
    }
  }

  revalidatePath("/app/expenses");
  revalidatePath("/app");
  return {};
}
