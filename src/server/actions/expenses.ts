"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMembership, ForbiddenError } from "@/server/tenant";
import { createExpenseSchema } from "@/lib/validation/invoices";

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

  const { businessId } = await requireMembership(parsed.data.businessId);

  // Tenant check on the category too — a categoryId from another business
  // must not be usable here even if someone forged the form field.
  const category = await prisma.category.findFirst({
    where: { id: parsed.data.categoryId, businessId },
  });
  if (!category) return { error: "Invalid category for this business" };

  try {
    await prisma.expense.create({
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
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    console.error("createExpense failed", err);
    return { error: "Could not save the expense. Please try again." };
  }

  revalidatePath("/app/expenses");
  revalidatePath("/app");
  return {};
}
