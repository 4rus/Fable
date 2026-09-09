import { z } from "zod";

const cents = z.number().int().nonnegative().max(1_000_000_000); // $10M ceiling, sanity bound

/**
 * `FormData.get("field")` returns `null` — not `undefined` — when a field
 * is absent from the submitted form. Zod's `.optional()` only treats
 * `undefined` as "not provided" and rejects `null` with a confusing
 * "Expected string, received null" error. Every optional text field parsed
 * straight from a FormData object needs this, not `.optional()` alone.
 */
function optionalText(maxLength: number) {
  return z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().max(maxLength).optional(),
  );
}

export const lineItemInput = z.object({
  description: z.string().trim().min(1).max(500),
  quantity: z.number().int().positive().max(1_000_000),
  unitPriceCents: cents,
});

export const createInvoiceSchema = z.object({
  businessId: z.string().min(1),
  customerId: z.string().min(1),
  issueDate: z.coerce.date(),
  dueDate: z.coerce.date(),
  taxCents: cents.default(0),
  notes: optionalText(2000),
  lineItems: z.array(lineItemInput).min(1).max(200),
});

export const recordPaymentSchema = z.object({
  businessId: z.string().min(1),
  invoiceId: z.string().min(1),
  amountCents: cents.positive(),
  method: z.enum(["cash", "check", "card", "bank_transfer", "other"]).default("other"),
  paidAt: z.coerce.date().default(() => new Date()),
  note: optionalText(1000),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const createCustomerSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.preprocess(
    (v) => (v === null || v === "" ? undefined : v),
    z.string().trim().toLowerCase().email().optional(),
  ),
  phone: optionalText(50),
  notes: optionalText(2000),
});

export const createExpenseSchema = z.object({
  businessId: z.string().min(1),
  categoryId: z.string().min(1),
  vendorName: z.string().trim().min(1).max(200),
  amountCents: cents.positive(),
  incurredAt: z.coerce.date(),
  description: optionalText(2000),
  isRecurring: z.boolean().default(false),
});
