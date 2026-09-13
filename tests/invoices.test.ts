import { describe, it, expect, beforeEach } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness, createTestCustomer } from "./helpers";
import {
  createInvoice,
  recordPayment,
  markInvoiceSent,
  OverpaymentError,
  InvalidInvoiceStateError,
  amountPaidCents,
  balanceDueCents,
  isOverdue,
} from "@/server/services/invoices";
import { ForbiddenError } from "@/server/tenant";

describe("invoice line item and total calculation", () => {
  it("computes amounts server-side from quantity * unitPriceCents, ignoring any client total", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);

    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000),
      taxCents: 500,
      lineItems: [
        { description: "Cleaning visit", quantity: 3, unitPriceCents: 4500 },
        { description: "Supplies", quantity: 1, unitPriceCents: 1200 },
      ],
    });

    expect(invoice.lineItems[0]!.amountCents).toBe(13500); // 3 * 4500
    expect(invoice.lineItems[1]!.amountCents).toBe(1200);
    expect(invoice.subtotalCents).toBe(14700);
    expect(invoice.totalCents).toBe(15200); // + 500 tax
    expect(invoice.status).toBe("DRAFT");
  });

  it("rejects a customer that belongs to a different business (IDOR guard)", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const customerOfB = await createTestCustomer(businessB.id);

    await expect(
      createInvoice({
        businessId: businessA.id,
        customerId: customerOfB.id,
        issueDate: new Date(),
        dueDate: new Date(),
        taxCents: 0,
        lineItems: [{ description: "x", quantity: 1, unitPriceCents: 100 }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });

  it("assigns sequential per-business invoice numbers", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    const makeOne = () =>
      createInvoice({
        businessId: business.id,
        customerId: customer.id,
        issueDate: new Date(),
        dueDate: new Date(),
        taxCents: 0,
        lineItems: [{ description: "x", quantity: 1, unitPriceCents: 100 }],
      });
    const first = await makeOne();
    const second = await makeOne();
    expect(first.number).not.toBe(second.number);
  });
});

describe("payments", () => {
  async function sentInvoice(totalCents: number) {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 14),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: totalCents }],
    });
    await markInvoiceSent(business.id, invoice.id);
    return { business, invoice };
  }

  it("supports a partial payment and reflects PARTIALLY_PAID status", async () => {
    const { business, invoice } = await sentInvoice(10000);
    const updated = await recordPayment({
      businessId: business.id,
      invoiceId: invoice.id,
      amountCents: 4000,
      method: "cash",
      paidAt: new Date(),
      idempotencyKey: "pay-1",
    });
    expect(updated.status).toBe("PARTIALLY_PAID");
    expect(amountPaidCents(updated)).toBe(4000);
    expect(balanceDueCents(updated)).toBe(6000);
  });

  it("marks PAID once payments sum to the total", async () => {
    const { business, invoice } = await sentInvoice(10000);
    await recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 4000, method: "cash", paidAt: new Date(), idempotencyKey: "pay-a" });
    const updated = await recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 6000, method: "cash", paidAt: new Date(), idempotencyKey: "pay-b" });
    expect(updated.status).toBe("PAID");
    expect(balanceDueCents(updated)).toBe(0);
  });

  it("rejects a payment that would overpay the invoice", async () => {
    const { business, invoice } = await sentInvoice(10000);
    await expect(
      recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 10001, method: "cash", paidAt: new Date(), idempotencyKey: "pay-over" }),
    ).rejects.toThrow(OverpaymentError);
  });

  it("THE CORE GUARANTEE under concurrency: two different, individually-valid payments fired at the same instant can never together overpay the invoice (Phase P)", async () => {
    // Adversarial test, not a made-up scenario: two team members recording
    // a payment on the same invoice within the same second (or one eager
    // double-click producing two different idempotency keys) is a
    // completely realistic real-world race, distinct from the
    // already-tested "retry the same key" idempotency case above. Each of
    // these two payments is individually valid against the invoice's
    // $100 total; only together do they overpay it — the question is
    // whether recordPayment's check-then-write is safe against two of
    // these running at literally the same time, not just sequentially.
    const { business, invoice } = await sentInvoice(10000);

    const attempt = (idempotencyKey: string) =>
      recordPayment({
        businessId: business.id,
        invoiceId: invoice.id,
        amountCents: 7000,
        method: "cash",
        paidAt: new Date(),
        idempotencyKey,
      });

    const results = await Promise.allSettled([attempt("race-a"), attempt("race-b")]);
    const succeeded = results.filter((r) => r.status === "fulfilled");
    const failed = results.filter((r) => r.status === "rejected");

    // Real, provable invariant, not just "at least one failed": read the
    // actual committed rows back and sum them — this is what would
    // actually be true in the database regardless of which branch above
    // took which path, and is what would catch a bug where both
    // "succeeded" from the caller's point of view but one silently
    // clamped or otherwise corrupted the total instead of throwing.
    const paidRows = await prisma.payment.findMany({
      where: { invoiceId: invoice.id, voidedAt: null },
    });
    const totalRecorded = paidRows.reduce((sum, p) => sum + p.amountCents, 0);
    expect(totalRecorded).toBeLessThanOrEqual(10000);

    // Exactly one should have succeeded and one should have been rejected
    // as an overpayment — not "both succeeded" (money bug) and not "both
    // failed" (a real payment incorrectly refused).
    expect(succeeded.length).toBe(1);
    expect(failed.length).toBe(1);
    if (failed[0]!.status === "rejected") {
      expect(failed[0]!.reason).toBeInstanceOf(OverpaymentError);
    }
  });

  it("is idempotent: retrying the same key does not double-record money", async () => {
    const { business, invoice } = await sentInvoice(10000);
    const key = "retry-key-1";
    const first = await recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 5000, method: "cash", paidAt: new Date(), idempotencyKey: key });
    const second = await recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 5000, method: "cash", paidAt: new Date(), idempotencyKey: key });

    expect(second.id).toBe(first.id);
    const payments = await prisma.payment.findMany({ where: { invoiceId: invoice.id } });
    expect(payments).toHaveLength(1); // not 2
    expect(amountPaidCents({ payments })).toBe(5000);
  });

  it("refuses to record a payment against a DRAFT invoice", async () => {
    const business = await createTestBusiness();
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 100 }],
    });
    await expect(
      recordPayment({ businessId: business.id, invoiceId: invoice.id, amountCents: 100, method: "cash", paidAt: new Date(), idempotencyKey: "draft-pay" }),
    ).rejects.toThrow(InvalidInvoiceStateError);
  });

  it("cannot record a payment against another business's invoice (cross-tenant guard)", async () => {
    const { invoice } = await sentInvoice(10000);
    const attackerBusiness = await createTestBusiness();
    await expect(
      recordPayment({
        businessId: attackerBusiness.id,
        invoiceId: invoice.id,
        amountCents: 100,
        method: "cash",
        paidAt: new Date(),
        idempotencyKey: "cross-tenant-1",
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});

describe("overdue derivation", () => {
  it("treats a SENT invoice past its due date as overdue, DRAFT/PAID as never overdue", () => {
    const past = new Date(Date.now() - 86_400_000);
    const future = new Date(Date.now() + 86_400_000);
    expect(isOverdue({ status: "SENT", dueDate: past })).toBe(true);
    expect(isOverdue({ status: "PARTIALLY_PAID", dueDate: past })).toBe(true);
    expect(isOverdue({ status: "SENT", dueDate: future })).toBe(false);
    expect(isOverdue({ status: "PAID", dueDate: past })).toBe(false);
    expect(isOverdue({ status: "DRAFT", dueDate: past })).toBe(false);
  });
});
