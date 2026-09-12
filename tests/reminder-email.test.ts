import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer } from "./helpers";
import { createInvoice, markInvoiceSent, recordPayment } from "@/server/services/invoices";
import { MissingCustomerEmailError } from "@/server/services/invoiceEmail";
import {
  sendInvoiceReminderEmail,
  ReminderNotSendableError,
  ReminderRateLimitedError,
} from "@/server/services/reminderEmail";
import { ForbiddenError } from "@/server/tenant";

// Same reasoning as tests/invoice-email.test.ts: force the honest
// not-configured path regardless of what's in the developer's real .env.
beforeEach(() => vi.stubEnv("RESEND_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

async function createSentInvoice(customerEmail: string | null, totalCents = 10_000) {
  const business = await createTestBusiness();
  const customer = await createTestCustomer(business.id);
  if (customerEmail) {
    await prisma.customer.update({ where: { id: customer.id }, data: { email: customerEmail } });
  }
  const invoice = await createInvoice({
    businessId: business.id,
    customerId: customer.id,
    issueDate: new Date(),
    dueDate: new Date(Date.now() + 86_400_000 * 14),
    taxCents: 0,
    lineItems: [{ description: "Work", quantity: 1, unitPriceCents: totalCents }],
  });
  await markInvoiceSent(business.id, invoice.id);
  return { business, customer, invoice };
}

describe("sendInvoiceReminderEmail", () => {
  it("refuses to send when the customer has no email on file", async () => {
    const { business, invoice } = await createSentInvoice(null);
    await expect(sendInvoiceReminderEmail(business.id, invoice.id)).rejects.toThrow(MissingCustomerEmailError);
  });

  it("refuses a reminder on a DRAFT invoice", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id, "billing@example.com");
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 5000 }],
    });
    await expect(sendInvoiceReminderEmail(business.id, invoice.id)).rejects.toThrow(ReminderNotSendableError);
  });

  it("refuses a reminder on an already-PAID invoice", async () => {
    const { business, invoice } = await createSentInvoice("billing@example.com", 5000);
    await recordPayment({
      businessId: business.id,
      invoiceId: invoice.id,
      amountCents: 5000,
      method: "cash",
      paidAt: new Date(),
      idempotencyKey: `reminder-paid-${invoice.id}`,
    });
    await expect(sendInvoiceReminderEmail(business.id, invoice.id)).rejects.toThrow(ReminderNotSendableError);
  });

  it("refuses a reminder on a VOID invoice", async () => {
    const { business, invoice } = await createSentInvoice("billing@example.com");
    await prisma.invoice.update({ where: { id: invoice.id }, data: { status: "VOID" } });
    await expect(sendInvoiceReminderEmail(business.id, invoice.id)).rejects.toThrow(ReminderNotSendableError);
  });

  it("reports not_configured (never a false success) and does not touch lastReminderSentAt or write an audit log", async () => {
    const { business, invoice } = await createSentInvoice("billing@example.com");
    expect(invoice.lastReminderSentAt).toBeNull();

    const result = await sendInvoiceReminderEmail(business.id, invoice.id);
    expect(result).toEqual({ delivered: false, reason: "not_configured" });

    const reloaded = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(reloaded.lastReminderSentAt).toBeNull();
    expect(reloaded.status).toBe("SENT"); // a reminder never changes invoice status

    const entry = await prisma.auditLog.findFirst({
      where: { businessId: business.id, action: "invoice.reminder_sent", entityId: invoice.id },
    });
    expect(entry).toBeNull();
  });

  it("is rate-limited: a second reminder within the cooldown window is refused with a clear message", async () => {
    const { business, invoice } = await createSentInvoice("billing@example.com");
    // Simulate a reminder having just gone out (RESEND_API_KEY unset means
    // sendInvoiceReminderEmail itself won't reach the point of setting
    // this, so set it directly to test the guard in isolation).
    await prisma.invoice.update({ where: { id: invoice.id }, data: { lastReminderSentAt: new Date() } });

    await expect(sendInvoiceReminderEmail(business.id, invoice.id)).rejects.toThrow(ReminderRateLimitedError);
  });

  it("allows a reminder again once the cooldown window has passed", async () => {
    const { business, invoice } = await createSentInvoice("billing@example.com");
    const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000);
    await prisma.invoice.update({ where: { id: invoice.id }, data: { lastReminderSentAt: twoDaysAgo } });

    // Not rate-limited any more -- falls through to the (unconfigured)
    // email path rather than throwing.
    const result = await sendInvoiceReminderEmail(business.id, invoice.id);
    expect(result).toEqual({ delivered: false, reason: "not_configured" });
  });

  it("cannot send a reminder for an invoice belonging to a different business (tenant isolation)", async () => {
    const { invoice } = await createSentInvoice("billing@example.com");
    const attackerBusiness = await createTestBusiness();
    await expect(sendInvoiceReminderEmail(attackerBusiness.id, invoice.id)).rejects.toThrow(ForbiddenError);
  });
});
