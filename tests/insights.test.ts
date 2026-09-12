import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer, createTestFinancialAccount, createTestTransaction } from "./helpers";
import { createInvoice, markInvoiceSent, recordPayment } from "@/server/services/invoices";
import {
  getOverdueInvoicesInsight,
  getRunwayWarningInsight,
  getNeedsReviewInsight,
  getCustomerConcentrationInsight,
  getCategorySpendSpikeInsight,
  getUpcomingDueInvoicesInsight,
  getDuplicateExpenseInsight,
  getAllInsights,
  summarizeInsights,
  type Insight,
} from "@/server/services/insights";

describe("getRunwayWarningInsight", () => {
  it("returns null when the 90-day forecast never goes negative", async () => {
    const business = await createTestBusiness();
    await prisma.business.update({
      where: { id: business.id },
      data: { startingCashCents: 10_000_000 }, // plenty of cash, no expenses on file
    });
    const insight = await getRunwayWarningInsight(business.id);
    expect(insight).toBeNull();
  });

  it("fires with the earliest horizon that goes negative, using the same numbers as the forecast engine", async () => {
    const business = await createTestBusiness();
    await prisma.business.update({
      where: { id: business.id },
      data: { startingCashCents: 100_000, startingCashAsOf: new Date(Date.now() - 100 * 86_400_000) },
    });
    const category = await prisma.category.create({
      data: { businessId: business.id, name: "Rent", type: "EXPENSE" },
    });
    // A large recurring expense guarantees the 90-day projection goes negative.
    for (let m = 1; m <= 3; m++) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      await prisma.expense.create({
        data: { businessId: business.id, categoryId: category.id, vendorName: "Landlord", amountCents: 500_000, incurredAt: d, isRecurring: true },
      });
    }

    const insight = await getRunwayWarningInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.severity).toBe("critical");
    expect(insight!.kind).toBe("RECOMMENDATION");
    expect(insight!.headline).toMatch(/run short on cash/);
  });
});

describe("getAllInsights", () => {
  it("aggregates whichever insights are non-null and never throws on an empty business", async () => {
    const business = await createTestBusiness();
    const insights = await getAllInsights(business.id);
    expect(Array.isArray(insights)).toBe(true);
  });

  it("every insight is traceable: evidence entries point at real invoice ids", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(Date.now() - 30 * 86_400_000),
      dueDate: new Date(Date.now() - 16 * 86_400_000),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 5000 }],
    });
    await markInvoiceSent(business.id, invoice.id);

    const insight = await getOverdueInvoicesInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.evidence).toHaveLength(1);

    const evidenced = await prisma.invoice.findUnique({ where: { id: insight!.evidence[0]!.id } });
    expect(evidenced).not.toBeNull();
    expect(evidenced!.businessId).toBe(business.id);
  });
});

describe("getNeedsReviewInsight (Phase G: bank review queue)", () => {
  it("returns null when there is nothing to review", async () => {
    const business = await createTestBusiness();
    expect(await getNeedsReviewInsight(business.id)).toBeNull();
  });

  it("surfaces a count of unreviewed synced transactions and links to /app/bank", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    await createTestTransaction(business.id, account.id, { amountCents: 1500 });

    const insight = await getNeedsReviewInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.headline).toMatch(/1 bank transaction needs your review/);
    expect(insight!.action?.href).toBe("/app/bank");
  });

  it("escalates to attention severity once there are several", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    for (let i = 0; i < 5; i++) {
      await createTestTransaction(business.id, account.id, { amountCents: 1000 + i });
    }
    const insight = await getNeedsReviewInsight(business.id);
    expect(insight!.severity).toBe("attention");
  });
});

describe("getCustomerConcentrationInsight", () => {
  async function paidInvoice(businessId: string, customerId: string, totalCents: number) {
    const invoice = await createInvoice({
      businessId,
      customerId,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 14),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: totalCents }],
    });
    await markInvoiceSent(businessId, invoice.id);
    await recordPayment({
      businessId,
      invoiceId: invoice.id,
      amountCents: totalCents,
      method: "cash",
      paidAt: new Date(),
      idempotencyKey: `concentration-${invoice.id}`,
    });
  }

  it("does not fire with only one paying customer, however large its share", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    await paidInvoice(business.id, customer.id, 100_000);
    expect(await getCustomerConcentrationInsight(business.id)).toBeNull();
  });

  it("does not fire when revenue is reasonably spread across customers", async () => {
    const business = await createTestBusiness();
    const a = await createTestCustomer(business.id, "Even A");
    const b = await createTestCustomer(business.id, "Even B");
    const c = await createTestCustomer(business.id, "Even C");
    await paidInvoice(business.id, a.id, 40_000);
    await paidInvoice(business.id, b.id, 30_000);
    await paidInvoice(business.id, c.id, 30_000);
    expect(await getCustomerConcentrationInsight(business.id)).toBeNull();
  });

  it("fires when one customer accounts for most of 90-day revenue", async () => {
    const business = await createTestBusiness();
    const whale = await createTestCustomer(business.id, "Whale Corp");
    const small = await createTestCustomer(business.id, "Small Co");
    await paidInvoice(business.id, whale.id, 900_000);
    await paidInvoice(business.id, small.id, 100_000);

    const insight = await getCustomerConcentrationInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.headline).toMatch(/^Whale Corp .* is 90% of your revenue/);
    expect(insight!.severity).toBe("attention"); // >= 75%
    expect(insight!.evidence[0]!.id).toBeTruthy();
  });
});

describe("getCategorySpendSpikeInsight", () => {
  it("names the specific category driving an increase, not just the aggregate", async () => {
    const business = await createTestBusiness();
    const spiking = await prisma.category.create({ data: { businessId: business.id, name: "Marketing", type: "EXPENSE" } });
    const steady = await prisma.category.create({ data: { businessId: business.id, name: "Rent", type: "EXPENSE" } });

    // Trailing 3 months: both categories steady at a modest baseline.
    for (let m = 1; m <= 3; m++) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      await prisma.expense.create({ data: { businessId: business.id, categoryId: spiking.id, vendorName: "Ad Co", amountCents: 20_000, incurredAt: d } });
      await prisma.expense.create({ data: { businessId: business.id, categoryId: steady.id, vendorName: "Landlord", amountCents: 150_000, incurredAt: d } });
    }
    // This month: Marketing spikes hard, Rent stays flat.
    await prisma.expense.create({ data: { businessId: business.id, categoryId: spiking.id, vendorName: "Ad Co", amountCents: 100_000, incurredAt: new Date() } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: steady.id, vendorName: "Landlord", amountCents: 150_000, incurredAt: new Date() } });

    const insight = await getCategorySpendSpikeInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.headline).toMatch(/^Marketing spending is up/);
  });

  it("ignores categories under the noise floor", async () => {
    const business = await createTestBusiness();
    const tiny = await prisma.category.create({ data: { businessId: business.id, name: "Bank Fees", type: "EXPENSE" } });
    for (let m = 1; m <= 3; m++) {
      const d = new Date();
      d.setMonth(d.getMonth() - m);
      await prisma.expense.create({ data: { businessId: business.id, categoryId: tiny.id, vendorName: "Bank", amountCents: 500, incurredAt: d } });
    }
    await prisma.expense.create({ data: { businessId: business.id, categoryId: tiny.id, vendorName: "Bank", amountCents: 5000, incurredAt: new Date() } });
    expect(await getCategorySpendSpikeInsight(business.id)).toBeNull();
  });
});

describe("getUpcomingDueInvoicesInsight", () => {
  it("returns null when nothing is due within 7 days", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 30),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 10_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);
    expect(await getUpcomingDueInvoicesInsight(business.id)).toBeNull();
  });

  it("surfaces invoices due soon, distinct from overdue ones", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id, "Maple Street Dental");
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 3),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 25_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);

    const insight = await getUpcomingDueInvoicesInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.explanation).toMatch(/Maple Street Dental/);

    // Must never also count as overdue -- it isn't due yet.
    const overdue = await getOverdueInvoicesInsight(business.id);
    expect(overdue).toBeNull();
  });
});

describe("getDuplicateExpenseInsight", () => {
  it("returns null when nothing matches", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 4000, incurredAt: new Date() } });
    expect(await getDuplicateExpenseInsight(business.id)).toBeNull();
  });

  it("flags the same vendor + amount logged within a few days of each other", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    const day1 = new Date();
    const day2 = new Date(day1.getTime() + 2 * 86_400_000);
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 4599, incurredAt: day1 } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 4599, incurredAt: day2 } });

    const insight = await getDuplicateExpenseInsight(business.id);
    expect(insight).not.toBeNull();
    expect(insight!.headline).toMatch(/Staples/);
    expect(insight!.evidence).toHaveLength(2);
  });

  it("does not flag the same vendor at a different amount, or a different vendor at the same amount", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    const now = new Date();
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 1000, incurredAt: now } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 2000, incurredAt: now } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Office Depot", amountCents: 1000, incurredAt: now } });
    expect(await getDuplicateExpenseInsight(business.id)).toBeNull();
  });

  it("does not flag two matching charges far apart in time", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({ data: { businessId: business.id, name: "Supplies", type: "EXPENSE" } });
    const now = new Date();
    const monthAgo = new Date(now.getTime() - 30 * 86_400_000);
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 4599, incurredAt: monthAgo } });
    await prisma.expense.create({ data: { businessId: business.id, categoryId: category.id, vendorName: "Staples", amountCents: 4599, incurredAt: now } });
    expect(await getDuplicateExpenseInsight(business.id)).toBeNull();
  });
});

function fakeInsight(overrides: Partial<Insight>): Insight {
  return {
    id: "test",
    kind: "FACT",
    severity: "info",
    headline: "Something happened",
    explanation: "Details",
    why: "Because reasons",
    basis: "Based on data",
    evidence: [],
    ...overrides,
  };
}

describe("summarizeInsights (drives the Overview page narrative)", () => {
  it("returns a plain positive headline with no spotlight when there are no insights", () => {
    const result = summarizeInsights([]);
    expect(result.spotlight).toBeNull();
    expect(result.rest).toEqual([]);
    expect(result.headline).toMatch(/good position/);
  });

  it("picks the most severe insight as the spotlight, regardless of input order", () => {
    const info = fakeInsight({ id: "info", severity: "info" });
    const critical = fakeInsight({ id: "critical", severity: "critical" });
    const attention = fakeInsight({ id: "attention", severity: "attention" });

    const result = summarizeInsights([info, attention, critical]);
    expect(result.spotlight!.id).toBe("critical");
    expect(result.rest.map((i) => i.id)).toEqual(["attention", "info"]);
  });

  it("escalates the headline tone with severity", () => {
    expect(summarizeInsights([fakeInsight({ severity: "critical" })]).headline).toMatch(/decision soon/);
    expect(summarizeInsights([fakeInsight({ severity: "attention" })]).headline).toMatch(/stable position/);
    expect(summarizeInsights([fakeInsight({ severity: "info" })]).headline).toMatch(/good position/);
  });
});
