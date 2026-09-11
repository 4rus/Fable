import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer } from "./helpers";
import { createInvoice } from "@/server/services/invoices";
import {
  sendInvoiceEmail,
  MissingCustomerEmailError,
  InvoiceNotSendableError,
} from "@/server/services/invoiceEmail";

// Force the "not configured" path regardless of whether a real
// RESEND_API_KEY happens to be set in the developer's .env — these tests
// exercise the honest not-configured path, the same one a fresh checkout
// of this repo hits before anyone adds a real API key. See tests/email.test.ts
// for why vi.stubEnv (not just deleting it in tests/setup.ts) is needed.
beforeEach(() => vi.stubEnv("RESEND_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

async function createTestInvoice(customerEmail: string | null) {
  const business = await createTestBusiness();
  const customer = await createTestCustomer(business.id);
  if (customerEmail) {
    await prisma.customer.update({ where: { id: customer.id }, data: { email: customerEmail } });
  }
  const invoice = await createInvoice({
    businessId: business.id,
    customerId: customer.id,
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 86_400_000),
    taxCents: 0,
    lineItems: [{ description: "Work", quantity: 1, unitPriceCents: 10000 }],
  });
  return { business, customer, invoice };
}

describe("sendInvoiceEmail", () => {
  it("refuses to send when the customer has no email on file", async () => {
    const { business, invoice } = await createTestInvoice(null);
    await expect(sendInvoiceEmail(business.id, invoice.id)).rejects.toThrow(MissingCustomerEmailError);
  });

  it("refuses to send a voided invoice", async () => {
    const { business, invoice } = await createTestInvoice("billing@example.com");
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
    await expect(sendInvoiceEmail(business.id, invoice.id)).rejects.toThrow(InvoiceNotSendableError);
  });

  it("reports not_configured (never a false success) when no email provider is set up, and does NOT advance status", async () => {
    const { business, invoice } = await createTestInvoice("billing@example.com");
    expect(invoice.status).toBe("DRAFT");

    const result = await sendInvoiceEmail(business.id, invoice.id);

    expect(result).toEqual({ delivered: false, reason: "not_configured" });

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.status).toBe("DRAFT"); // unchanged -- never claim delivery that didn't happen
  });

  it("does not write an audit log entry when delivery didn't happen", async () => {
    const { business, invoice } = await createTestInvoice("billing@example.com");
    await sendInvoiceEmail(business.id, invoice.id);

    const entry = await prisma.auditLog.findFirst({
      where: { businessId: business.id, action: "invoice.email_sent", entityId: invoice.id },
    });
    expect(entry).toBeNull();
  });
});
