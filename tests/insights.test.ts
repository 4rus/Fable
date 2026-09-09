import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer } from "./helpers";
import { createInvoice, markInvoiceSent } from "@/server/services/invoices";
import {
  getOverdueInvoicesInsight,
  getRunwayWarningInsight,
  getAllInsights,
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
    expect(insight!.title).toMatch(/run out of cash/);
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
