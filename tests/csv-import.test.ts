import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import { createTestBusiness } from "./helpers";
import { parseExpenseCsv, commitExpenseImport, CsvParseError } from "@/server/services/csvImport";
import { ForbiddenError } from "@/server/tenant";

describe("parseExpenseCsv", () => {
  it("extracts negative amounts as expenses from a single signed Amount column", () => {
    const csv = ["Date,Description,Amount", "2026-01-05,Office Depot,-42.50", "2026-01-06,Client Payment,500.00"].join("\n");
    const result = parseExpenseCsv(csv);
    expect(result.expenseRows).toHaveLength(1);
    expect(result.expenseRows[0]!.vendorName).toBe("Office Depot");
    expect(result.expenseRows[0]!.amountCents).toBe(4250);
    expect(result.skippedIncomeCount).toBe(1); // the +$500 deposit
  });

  it("handles separate Debit/Credit columns", () => {
    const csv = [
      "Transaction Date,Memo,Debit,Credit",
      "2026-02-01,Gas Station,35.00,",
      "2026-02-02,Customer Deposit,,200.00",
    ].join("\n");
    const result = parseExpenseCsv(csv);
    expect(result.expenseRows).toHaveLength(1);
    expect(result.expenseRows[0]!.vendorName).toBe("Gas Station");
    expect(result.expenseRows[0]!.amountCents).toBe(3500);
    expect(result.skippedIncomeCount).toBe(1);
  });

  it("handles currency symbols, thousands separators, and parenthesized negatives", () => {
    const csv = ["Date,Description,Amount", '2026-01-01,Big Purchase,"($1,234.56)"'].join("\n");
    const result = parseExpenseCsv(csv);
    expect(result.expenseRows).toHaveLength(1);
    expect(result.expenseRows[0]!.amountCents).toBe(123456);
  });

  it("never fabricates a payment/invoice link for income rows — just counts them", () => {
    const csv = ["Date,Description,Amount", "2026-01-01,Some Deposit,1000.00"].join("\n");
    const result = parseExpenseCsv(csv);
    expect(result.expenseRows).toHaveLength(0);
    expect(result.skippedIncomeCount).toBe(1);
  });

  it("skips rows with an unparseable date or amount rather than crashing", () => {
    const csv = [
      "Date,Description,Amount",
      "not-a-date,Weird Row,-10.00",
      "2026-01-01,Bad Amount,not-a-number",
      "2026-01-02,Good Row,-25.00",
    ].join("\n");
    const result = parseExpenseCsv(csv);
    expect(result.expenseRows).toHaveLength(1);
    expect(result.expenseRows[0]!.vendorName).toBe("Good Row");
    expect(result.skippedInvalidCount).toBe(2);
  });

  it("rejects a file with no recognizable date column", () => {
    expect(() => parseExpenseCsv("Foo,Bar\n1,2")).toThrow(CsvParseError);
  });

  it("rejects a file with no amount/debit/credit column", () => {
    expect(() => parseExpenseCsv("Date,Description\n2026-01-01,x")).toThrow(CsvParseError);
  });

  it("rejects an empty file", () => {
    expect(() => parseExpenseCsv("Date,Description,Amount\n")).toThrow(CsvParseError);
  });
});

describe("commitExpenseImport", () => {
  it("creates expenses under the given category", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({
      data: { businessId: business.id, name: "Supplies", type: "EXPENSE" },
    });

    const result = await commitExpenseImport({
      businessId: business.id,
      categoryId: category.id,
      rows: [
        { incurredAt: new Date("2026-01-01"), vendorName: "Vendor A", amountCents: 1000 },
        { incurredAt: new Date("2026-01-02"), vendorName: "Vendor B", amountCents: 2000 },
      ],
    });

    expect(result.createdCount).toBe(2);
    expect(result.duplicateCount).toBe(0);

    const expenses = await prisma.expense.findMany({ where: { businessId: business.id } });
    expect(expenses).toHaveLength(2);
    expect(expenses.every((e) => e.categoryId === category.id)).toBe(true);
  });

  it("skips rows that duplicate an expense already on file (same vendor, amount, day)", async () => {
    const business = await createTestBusiness();
    const category = await prisma.category.create({
      data: { businessId: business.id, name: "Supplies", type: "EXPENSE" },
    });
    await prisma.expense.create({
      data: { businessId: business.id, categoryId: category.id, vendorName: "Vendor A", amountCents: 1000, incurredAt: new Date("2026-01-01T08:00:00Z") },
    });

    const result = await commitExpenseImport({
      businessId: business.id,
      categoryId: category.id,
      rows: [{ incurredAt: new Date("2026-01-01T20:00:00Z"), vendorName: "Vendor A", amountCents: 1000 }],
    });

    expect(result.createdCount).toBe(0);
    expect(result.duplicateCount).toBe(1);
    const expenses = await prisma.expense.findMany({ where: { businessId: business.id } });
    expect(expenses).toHaveLength(1); // not doubled
  });

  it("rejects a category that belongs to a different business (tenant isolation)", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const categoryOfB = await prisma.category.create({
      data: { businessId: businessB.id, name: "Supplies", type: "EXPENSE" },
    });

    await expect(
      commitExpenseImport({
        businessId: businessA.id,
        categoryId: categoryOfB.id,
        rows: [{ incurredAt: new Date(), vendorName: "X", amountCents: 100 }],
      }),
    ).rejects.toThrow(ForbiddenError);
  });
});
