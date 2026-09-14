import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer } from "./helpers";
import { createInvoice, markInvoiceSent, recordPayment } from "@/server/services/invoices";
import { getCurrentCashCents, computeForecast, customerOnTimeRate } from "@/server/services/forecast";

describe("current cash calculation", () => {
  it("starts from startingCashCents and adds payments, subtracts expenses after that date", async () => {
    const business = await createTestBusiness();
    // startingCashConfirmedAt set — this is a REAL confirmed snapshot
    // (Phase N), which is what makes the day-level cutoff below apply at
    // all. See the "never confirmed" tests further down for the
    // opposite, equally real case.
    await prisma.business.update({
      where: { id: business.id },
      data: {
        startingCashCents: 100_000,
        startingCashAsOf: new Date(Date.now() - 10 * 86_400_000),
        startingCashConfirmedAt: new Date(),
      },
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
    await prisma.business.update({
      where: { id: business.id },
      data: { startingCashCents: 50_000, startingCashAsOf: asOf, startingCashConfirmedAt: new Date() },
    });
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

  it("a CONFIRMED starting balance excludes its ENTIRE calendar day, not just the exact timestamp it was saved at (Phase Q)", async () => {
    // Real bug, found live: a starting balance "as of Sep 14" (saved at,
    // say, 2:46:29 PM) previously only excluded transactions strictly
    // BEFORE that exact second — a payment recorded the same day via the
    // UI's date-only picker (which parses as UTC midnight, always
    // earlier than any same-day timestamp) fell on the wrong side of
    // that line and was silently excluded from "cash available today"
    // even though it happened after the snapshot was taken.
    const business = await createTestBusiness();
    const confirmedAfternoon = new Date();
    confirmedAfternoon.setUTCHours(14, 46, 29, 0);
    await prisma.business.update({
      where: { id: business.id },
      data: { startingCashCents: 10_000, startingCashAsOf: confirmedAfternoon, startingCashConfirmedAt: new Date() },
    });
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 5_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);
    // Same calendar day as confirmedAfternoon, but parsed as UTC
    // midnight (exactly what a date-only <input type="date"> produces) —
    // earlier in clock time, but NOT a transaction that predates the
    // snapshot in any meaningful sense.
    const sameDayMidnight = new Date(confirmedAfternoon);
    sameDayMidnight.setUTCHours(0, 0, 0, 0);
    await recordPayment({
      businessId: business.id,
      invoiceId: invoice.id,
      amountCents: 5_000,
      method: "cash",
      paidAt: sameDayMidnight,
      idempotencyKey: "same-day-midnight",
    });

    // Still excluded — same calendar day as the confirmed snapshot.
    expect(await getCurrentCashCents(business.id)).toBe(10_000);
  });

  it("a business that has NEVER confirmed a starting balance counts every payment/expense ever recorded, including same-day ones (Phase Q)", async () => {
    // The default $0/creation-timestamp pair is a placeholder, not a real
    // snapshot — there's nothing to avoid double-counting against, so
    // the old day-boundary logic should never apply here at all. This is
    // the exact scenario that broke live: a brand-new signup's first
    // same-day payment must count in full.
    const business = await createTestBusiness(); // startingCashConfirmedAt is null by default
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 550_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);
    const todayMidnightUtc = new Date();
    todayMidnightUtc.setUTCHours(0, 0, 0, 0);
    await recordPayment({
      businessId: business.id,
      invoiceId: invoice.id,
      amountCents: 550_000,
      method: "bank_transfer",
      paidAt: todayMidnightUtc,
      idempotencyKey: "never-confirmed-same-day",
    });

    expect(await getCurrentCashCents(business.id)).toBe(550_000);
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

describe("computeForecast: uncertainty range", () => {
  it("with no data at all, low/high/point are all zero-ranged around current cash", async () => {
    const business = await createTestBusiness();
    const forecast = await computeForecast(business.id, 30);
    expect(forecast.range.lowCents).toBe(forecast.currentCashCents);
    expect(forecast.range.highCents).toBe(forecast.currentCashCents);
  });

  it("the point estimate always falls inside its own [low, high] range", async () => {
    const business = await createTestBusiness();
    const a = await createTestCustomer(business.id, "Proven Payer");
    const b = await createTestCustomer(business.id, "Unknown Customer");

    // Proven payer: perfect on-time history.
    const history = await createInvoice({ businessId: business.id, customerId: a.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 1000 }] });
    await markInvoiceSent(business.id, history.id);
    await recordPayment({ businessId: business.id, invoiceId: history.id, amountCents: 1000, method: "cash", paidAt: new Date(), idempotencyKey: "range-hist-1" });

    const openA = await createInvoice({ businessId: business.id, customerId: a.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 4000 }] });
    await markInvoiceSent(business.id, openA.id);
    const openB = await createInvoice({ businessId: business.id, customerId: b.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 6000 }] });
    await markInvoiceSent(business.id, openB.id);

    const category = await prisma.category.create({ data: { businessId: business.id, name: "Rent", type: "EXPENSE" } });
    // Recurring spend that varies month to month, so low/high genuinely differ.
    for (const [monthsAgo, amountCents] of [[0, 200_000], [1, 100_000], [2, 150_000]] as const) {
      const d = new Date();
      d.setDate(d.getDate() - monthsAgo * 30);
      await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Landlord", amountCents, incurredAt: d, isRecurring: true } });
    }

    const forecast = await computeForecast(business.id, 30);
    expect(forecast.range.lowCents).toBeLessThanOrEqual(forecast.projectedCashCents);
    expect(forecast.range.highCents).toBeGreaterThanOrEqual(forecast.projectedCashCents);
    expect(forecast.range.lowCents).toBeLessThan(forecast.range.highCents);
  });

  it("the pessimistic edge counts nothing from a customer with no payment history; the optimistic edge counts every open invoice in full", async () => {
    const business = await createTestBusiness();
    const unknown = await createTestCustomer(business.id, "Brand New Customer");
    const invoice = await createInvoice({ businessId: business.id, customerId: unknown.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 30_000 }] });
    await markInvoiceSent(business.id, invoice.id);

    const forecast = await computeForecast(business.id, 30);
    // No recurring expenses on file, so the range is receivables-only here.
    expect(forecast.range.lowCents).toBe(forecast.currentCashCents); // 0% credited
    expect(forecast.range.highCents).toBe(forecast.currentCashCents + 30_000); // 100% credited
  });
});

describe("computeForecast: topDrivers", () => {
  it("lists real invoices and recurring vendors as drivers, sorted by impact, never fabricated", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id, "Big Client");
    const invoice = await createInvoice({ businessId: business.id, customerId: customer.id, issueDate: new Date(), dueDate: new Date(Date.now() + 86_400_000), taxCents: 0, lineItems: [{ description: "x", quantity: 1, unitPriceCents: 50_000 }] });
    await markInvoiceSent(business.id, invoice.id);

    const category = await prisma.category.create({ data: { businessId: business.id, name: "Software", type: "EXPENSE" } });
    for (let m = 0; m < 3; m++) {
      const d = new Date();
      d.setDate(d.getDate() - m * 30);
      await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Cloud Host", amountCents: 9_000, incurredAt: d, isRecurring: true } });
    }

    const forecast = await computeForecast(business.id, 30);
    const labels = forecast.topDrivers.map((d) => d.label);
    expect(labels.some((l) => l.includes(invoice.number))).toBe(true);
    expect(labels).toContain("Cloud Host");

    const invoiceDriver = forecast.topDrivers.find((d) => d.label.includes(invoice.number));
    expect(invoiceDriver?.direction).toBe("in");
    const vendorDriver = forecast.topDrivers.find((d) => d.label === "Cloud Host");
    expect(vendorDriver?.direction).toBe("out");

    // Sorted by magnitude, largest first.
    for (let i = 1; i < forecast.topDrivers.length; i++) {
      expect(forecast.topDrivers[i - 1]!.amountCents).toBeGreaterThanOrEqual(forecast.topDrivers[i]!.amountCents);
    }
  });

  it("caps at 5 drivers even with more real contributors on file", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    for (let i = 0; i < 8; i++) {
      await prisma.expense.create({
        data: { businessId: business.id, categoryId: category.id, vendorName: `Vendor ${i}`, amountCents: 1000 + i, incurredAt: new Date(), isRecurring: true },
      });
    }
    const forecast = await computeForecast(business.id, 30);
    expect(forecast.topDrivers.length).toBeLessThanOrEqual(5);
  });
});
