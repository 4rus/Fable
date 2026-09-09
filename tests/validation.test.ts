import { describe, it, expect } from "vitest";
import {
  recordPaymentSchema,
  createCustomerSchema,
  createExpenseSchema,
  createInvoiceSchema,
} from "@/lib/validation/invoices";

/**
 * Regression coverage for a real bug caught during manual UI testing:
 * `FormData.get("field")` returns `null` (not `undefined`) for a field
 * that isn't in the submitted form. Zod's `.optional()` only treats
 * `undefined` as "absent" and rejects `null`, so every optional field
 * fed straight from a form's FormData must be tested against a `null`
 * value, not just an omitted key — omitting the key from a plain object
 * literal in a test does NOT reproduce the bug.
 */
describe("form schemas tolerate FormData's null (not just undefined) for optional fields", () => {
  it("recordPaymentSchema accepts a null `note` (no note field on the form)", () => {
    const result = recordPaymentSchema.safeParse({
      businessId: "biz1",
      invoiceId: "inv1",
      amountCents: 500,
      method: "cash",
      paidAt: new Date(),
      note: null,
      idempotencyKey: "key1",
    });
    expect(result.success).toBe(true);
  });

  it("createCustomerSchema accepts null email/phone/notes", () => {
    const result = createCustomerSchema.safeParse({
      businessId: "biz1",
      name: "Acme",
      email: null,
      phone: null,
      notes: null,
    });
    expect(result.success).toBe(true);
  });

  it("createExpenseSchema accepts a null description", () => {
    const result = createExpenseSchema.safeParse({
      businessId: "biz1",
      categoryId: "cat1",
      vendorName: "Vendor",
      amountCents: 100,
      incurredAt: new Date(),
      description: null,
      isRecurring: false,
    });
    expect(result.success).toBe(true);
  });

  it("createInvoiceSchema accepts a null notes field", () => {
    const result = createInvoiceSchema.safeParse({
      businessId: "biz1",
      customerId: "cust1",
      issueDate: new Date(),
      dueDate: new Date(),
      taxCents: 0,
      notes: null,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 100 }],
    });
    expect(result.success).toBe(true);
  });

  it("still rejects a genuinely invalid email rather than silently dropping it", () => {
    const result = createCustomerSchema.safeParse({
      businessId: "biz1",
      name: "Acme",
      email: "not-an-email",
    });
    expect(result.success).toBe(false);
  });
});
