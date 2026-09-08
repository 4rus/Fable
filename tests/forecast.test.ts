import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer } from "./helpers";
import { createInvoice, markInvoiceSent, recordPayment } from "@/server/services/invoices";
import { getCurrentCashCents, computeForecast, customerOnTimeRate } from "@/server/services/forecast";

describe("current cash calculation", () => {
  it("starts from startingCashCents and adds payments, subtracts expenses after that date", async () => {
    const business = await createTestBusiness();
    await prisma.business.update({
      where: { id: business.id },
      data: { startingCashCents: 100_000, startingCashAsOf: new Date(Date.now() - 10 * 86_400_000) },
    });
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 20_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);
    await recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 20_000, method: "cash", paidAt: new Date(), idempotencyKey: "cash-test-1" });

    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Vendor", amountCents: 5_000, incurredAt: new Date() } });

    const cash = await getCurrentCashCents(business.id);
    expect(cash).toBe(100_000 + 20_000 - 5_000);
  });

  it("ignores payments/expenses dated before the starting-cash cutoff (they're already baked into the starting figure)", async () => {
    const business = await createTestBusiness();
    const asOf = new Date();
    await prisma.business.update({ where: { id: business.id }, data: { startingCashCents: 50_000, startingCashAsOf: asOf } });
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 10_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);
    // Paid before the cutoff — should not be double-counted.
    await recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 10_000, method: "cash", paidAt: new Date(asOf.getTime() - 1000), idempotencyKey: "before-cutoff" });

    const cash = await getCurrentCashCents(business.id);
    expect(cash).toBe(50_000);
  });
});

describe("customerOnTimeRate", () => {
  it("returns null when a customer has no fully-paid invoice history", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    const rate = await customerOnTimeRate(business.id, customer.id);
    expect(rate).toBeNull();
  });

  it("computes the fraction of invoices paid on or before their due date", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);

    // Paid on time
    const inv1 = await createInvoice({ businessId: business.id, customerId: customer.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 1000 }] });
    await markInvoiceSent(business.id, inv1.id);
    await recordPayment({ businessId: business.id, invoiceId: inv1.id, amountCents: 1000, method: "cash", paidAt: new Date(), idempotencyKey: "ontime-1" });

    // Paid late
    const inv2 = await createInvoice({ businessId: business.id, customerId: customer.id, issueDate: new Date(Date.now() - 20 * 86_400_000), dueDate: new Date(Date.now() - 10 * 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 1000 }] });
    await markInvoiceSent(business.id, inv2.id);
    await recordPayment({ businessId: business.id, invoiceId: inv2.id, amountCents: 1000, method: "cash", paidAt: new Date(), idempotencyKey: "late-1" });

    const rate = await customerOnTimeRate(business.id, customer.id);
    expect(rate).toBe(0.5);
  });
});

describe("computeForecast", () => {
  it("is low confidence and flags the assumption when there is no data at all", async () => {
    const business = await createTestBusiness();
    const forecast = await computeForecast(business.id, 30);
    expect(forecast.confidence).toBe("low");
    expect(forecast.expectedExpensesCents).toBe(0);
    expect(forecast.expectedReceivablesCents).toBe(0);
    expect(forecast.assumptions.length).toBeGreaterThan(0);
  });

  it("weights an open invoice's expected collection by the customer's on-time history", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);

    // Establish a 100% on-time history.
    const history = await createInvoice({ businessId: business.id, customerId: customer.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 1000 }] });
    await markInvoiceSent(business.id, history.id);
    await recordPayment({ businessId: business.id, invoiceId: history.id, amountCents: 1000, method: "cash", paidAt: new Date(), idempotencyKey: "hist-1" });

    // One open invoice, should be weighted ~1.0 given perfect history.
    const open = await createInvoice({ businessId: business.id, customerId: customer.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 5000 }] });
    await markInvoiceSent(business.id, open.id);

    const forecast = await computeForecast(business.id, 30);
    expect(forecast.expectedReceivablesCents).toBe(5000);
  });

  it("every dollar in the projection can be traced to currentCash + receivables - expenses", async () => {
    const business = await createTestBusiness();
    const forecast = await computeForecast(business.id, 60);
    expect(forecast.projectedCashCents).toBe(
      forecast.currentCashCents + forecast.expectedReceivablesCents - forecast.expectedExpensesCents,
    );
  });
});
