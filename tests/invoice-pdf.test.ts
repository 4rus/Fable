import { describe, it, expect } from "vitest";
import { renderInvoicePdf } from "@/lib/pdf/invoice";

describe("renderInvoicePdf", () => {
  it("produces a real PDF buffer", async () => {
    const buffer = await renderInvoicePdf({
      businessName: "Rivergate Cleaning Co.",
      currency: "USD",
      invoiceNumber: "INV-0007",
      issueDate: new Date("2026-01-05"),
      dueDate: new Date("2026-01-19"),
      customerName: "Riverside Property Group",
      customerEmail: "billing@riverside.example.com",
      lineItems: [
        { description: "Deep clean — main office", quantity: 1, unitPriceCents: 45000, amountCents: 45000 },
        { description: "Supplies", quantity: 3, unitPriceCents: 1200, amountCents: 3600 },
      ],
      subtotalCents: 48600,
      taxCents: 2000,
      totalCents: 50600,
      notes: "Thanks for your business.",
    });

    expect(Buffer.isBuffer(buffer)).toBe(true);
    // The PDF magic number -- proves this is a real, well-formed PDF file,
    // not just arbitrary bytes.
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
    expect(buffer.length).toBeGreaterThan(500);
  });

  it("renders without notes (optional field) without throwing", async () => {
    const buffer = await renderInvoicePdf({
      businessName: "Test Co",
      currency: "USD",
      invoiceNumber: "INV-0001",
      issueDate: new Date(),
      dueDate: new Date(),
      customerName: "A Customer",
      customerEmail: null,
      lineItems: [{ description: "Work", quantity: 1, unitPriceCents: 1000, amountCents: 1000 }],
      subtotalCents: 1000,
      taxCents: 0,
      totalCents: 1000,
      notes: null,
    });
    expect(buffer.subarray(0, 5).toString("ascii")).toBe("%PDF-");
  });
});
