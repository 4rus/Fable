import { z } from "zod";

const cents = z.number().int().nonnegative().max(1_000_000_000); // $10M ceiling, sanity bound

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
  notes: z.string().trim().max(2000).optional(),
  lineItems: z.array(lineItemInput).min(1).max(200),
});

export const recordPaymentSchema = z.object({
  businessId: z.string().min(1),
  invoiceId: z.string().min(1),
  amountCents: cents.positive(),
  method: z.enum(["cash", "check", "card", "bank_transfer", "other"]).default("other"),
  paidAt: z.coerce.date().default(() => new Date()),
  note: z.string().trim().max(1000).optional(),
  idempotencyKey: z.string().trim().min(1).max(200),
});

export const createCustomerSchema = z.object({
  businessId: z.string().min(1),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().toLowerCase().email().optional().or(z.literal("")),
  phone: z.string().trim().max(50).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const createExpenseSchema = z.object({
  businessId: z.string().min(1),
  categoryId: z.string().min(1),
  vendorName: z.string().trim().min(1).max(200),
  amountCents: cents.positive(),
  incurredAt: z.coerce.date(),
  description: z.string().trim().max(2000).optional(),
  isRecurring: z.boolean().default(false),
});
