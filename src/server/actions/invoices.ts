"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requireMembership } from "@/server/tenant";
import { createInvoiceSchema, recordPaymentSchema } from "@/lib/validation/invoices";
import {
  createInvoice,
  markInvoiceSent,
  recordPayment,
  OverpaymentError,
  InvalidInvoiceStateError,
} from "@/server/services/invoices";
import { ForbiddenError } from "@/server/tenant";

export type ActionState = { error?: string };

export async function createInvoiceAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  let lineItems: unknown;
  try {
    lineItems = JSON.parse(String(formData.get("lineItems") ?? "[]"));
  } catch {
    return { error: "Invalid line items" };
  }

  const parsed = createInvoiceSchema.safeParse({
    businessId: formData.get("businessId"),
    customerId: formData.get("customerId"),
    issueDate: formData.get("issueDate"),
    dueDate: formData.get("dueDate"),
    taxCents: Number(formData.get("taxCents") ?? 0),
    notes: formData.get("notes"),
    lineItems,
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { businessId } = await requireMembership(parsed.data.businessId);

  let invoiceId: string;
  try {
    const invoice = await createInvoice({ ...parsed.data, businessId });
    invoiceId = invoice.id;
  } catch (err) {
    if (err instanceof ForbiddenError) return { error: err.message };
    console.error("createInvoice failed", err);
    return { error: "Could not create the invoice. Please try again." };
  }

  revalidatePath("/app/invoices");
  redirect(`/app/invoices/${invoiceId}`);
}

export async function sendInvoiceAction(businessId: string, invoiceId: string) {
  const ctx = await requireMembership(businessId);
  await markInvoiceSent(ctx.businessId, invoiceId);
  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath("/app/invoices");
}

export async function recordPaymentAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = recordPaymentSchema.safeParse({
    businessId: formData.get("businessId"),
    invoiceId: formData.get("invoiceId"),
    amountCents: Math.round(Number(formData.get("amountDollars") ?? 0) * 100),
    method: formData.get("method"),
    paidAt: formData.get("paidAt") || new Date(),
    note: formData.get("note"),
    // A fresh key per form render (see hidden input in the form) so a
    // double-click or network retry of the SAME submission can't double-
    // record the payment, while genuinely re-submitting the form (new
    // page load) generates a new key and is treated as a new payment.
    idempotencyKey: formData.get("idempotencyKey"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  const { businessId } = await requireMembership(parsed.data.businessId);

  try {
    await recordPayment({ ...parsed.data, businessId });
  } catch (err) {
    if (err instanceof OverpaymentError || err instanceof InvalidInvoiceStateError) {
      return { error: err.message };
    }
    if (err instanceof ForbiddenError) return { error: err.message };
    console.error("recordPayment failed", err);
    return { error: "Could not record the payment. Please try again." };
  }

  revalidatePath(`/app/invoices/${parsed.data.invoiceId}`);
  revalidatePath("/app/invoices");
  revalidatePath("/app");
  return {};
}
