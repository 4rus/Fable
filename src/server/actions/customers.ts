"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/db";
import { requireMembership } from "@/server/tenant";
import { createCustomerSchema } from "@/lib/validation/invoices";

export type ActionState = { error?: string };

export async function createCustomerAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createCustomerSchema.safeParse({
    businessId: formData.get("businessId"),
    name: formData.get("name"),
    email: formData.get("email"),
    phone: formData.get("phone"),
    notes: formData.get("notes"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // requireMembership treats businessId as untrusted input and verifies the
  // logged-in user actually has active access to it before anything else runs.
  const { businessId } = await requireMembership(parsed.data.businessId);

  await prisma.customer.create({
    data: {
      businessId,
      name: parsed.data.name,
      email: parsed.data.email || null,
      phone: parsed.data.phone || null,
      notes: parsed.data.notes || null,
    },
  });

  revalidatePath("/app/customers");
  return {};
}
