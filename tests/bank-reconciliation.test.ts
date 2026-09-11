import { describe, it, expect } from "vitest";
import { prisma } from "@/lib/db";
import {
  createTestBusiness,
  createTestCustomer,
  createTestFinancialAccount,
  createTestTransaction,
} from "./helpers";
import { createInvoice, markInvoiceSent } from "@/server/services/invoices";
import {
  categorizeBySavedRule,
  suggestCategoryForTransaction,
  setTransactionCategory,
} from "@/server/services/bank/categorization";
import {
  confirmExpenseFromTransaction,
  confirmInvoicePayment,
  ignoreTransaction,
  findInvoiceMatch,
  listTransactionsNeedingReview,
  InvalidTransactionError,
} from "@/server/services/bank/reconciliation";
import { getAllInsights } from "@/server/services/insights";
import { computeForecast } from "@/server/services/forecast";
import { ForbiddenError } from "@/server/tenant";
import { OverpaymentError } from "@/server/services/invoices";

/**
 * Phase G — real integration tests against the real Postgres "test"
 * schema (see tests/setup.ts / global-setup.ts), no mocking of the
 * database or the services under test. Plaid itself is never involved
 * here: these tests exercise categorization + reconciliation once a
 * Transaction row already exists (created directly, exactly like a real
 * sync would leave it) — the sync path itself is covered separately in
 * bank-connections.test.ts against real Plaid Sandbox.
 */

async function expenseCategory(businessId: string, name = "Software & Subscriptions") {
  return prisma.category.create({ data: { businessId, name, type: "EXPENSE" } });
}

describe("categorization", () => {
  it("has no rule for a never-seen merchant — never guesses", async () => {
    const business = await createTestBusiness();
    const result = await categorizeBySavedRule(business.id, "Some Random Merchant", "SOME RANDOM MERCHANT");
    expect(result).toBeNull();
  });

  it("setTransactionCategory learns a merchant rule that categorizeBySavedRule then applies", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);
    const txn = await createTestTransaction(business.id, account.id, { merchantName: "Acme Coffee Co #4821" });

    await setTransactionCategory(business.id, txn.id, category.id);

    const stored = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(stored.categoryId).toBe(category.id);
    expect(stored.categorySource).toBe("manual");

    // A second, differently-numbered transaction from the "same" merchant
    // (store-number noise stripped by normalizeMerchantKey) now
    // auto-categorizes with high confidence.
    const learned = await categorizeBySavedRule(business.id, "Acme Coffee Co #9910", "ACME COFFEE CO #9910");
    expect(learned).toEqual({ categoryId: category.id, source: "merchant_rule" });
  });

  it("tenant isolation: a merchant rule learned for business A never applies to business B", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const accountA = await createTestFinancialAccount(businessA.id);
    const categoryA = await expenseCategory(businessA.id);
    const txnA = await createTestTransaction(businessA.id, accountA.id, { merchantName: "Shared Vendor Inc" });

    await setTransactionCategory(businessA.id, txnA.id, categoryA.id);

    const resultForB = await categorizeBySavedRule(businessB.id, "Shared Vendor Inc", "SHARED VENDOR INC");
    expect(resultForB).toBeNull();
  });

  it("rejects setting a category that belongs to a different business", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const accountA = await createTestFinancialAccount(businessA.id);
    const categoryB = await expenseCategory(businessB.id);
    const txnA = await createTestTransaction(businessA.id, accountA.id);

    await expect(setTransactionCategory(businessA.id, txnA.id, categoryB.id)).rejects.toThrow();
  });

  it("suggestCategoryForTransaction only offers a category the business actually has", async () => {
    const business = await createTestBusiness();
    const noMatch = await suggestCategoryForTransaction(business.id, "AWS", "AMAZON WEB SERVICES");
    expect(noMatch).toBeNull(); // no "Software & Subscriptions" category exists yet

    await expenseCategory(business.id, "Software & Subscriptions");
    const match = await suggestCategoryForTransaction(business.id, "AWS", "AMAZON WEB SERVICES");
    expect(match?.categoryName).toBe("Software & Subscriptions");
  });
});

describe("expense reconciliation", () => {
  it("creates an Expense linked to its source transaction and learns the merchant rule", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);
    const txn = await createTestTransaction(business.id, account.id, {
      amountCents: 4599,
      merchantName: "Office Supply Co",
    });

    const expense = await confirmExpenseFromTransaction(business.id, txn.id, category.id);
    expect(expense.amountCents).toBe(4599);
    expect(expense.transactionId).toBe(txn.id);

    const storedTxn = await prisma.transaction.findUniqueOrThrow({ where: { id: txn.id } });
    expect(storedTxn.categoryId).toBe(category.id);

    const rule = await prisma.merchantCategoryRule.findUnique({
      where: { businessId_merchantKey: { businessId: business.id, merchantKey: "office supply co" } },
    });
    expect(rule?.categoryId).toBe(category.id);
  });

  it("is idempotent: confirming the same transaction twice never creates two Expenses", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);
    const txn = await createTestTransaction(business.id, account.id, { amountCents: 2000 });

    const first = await confirmExpenseFromTransaction(business.id, txn.id, category.id);
    const second = await confirmExpenseFromTransaction(business.id, txn.id, category.id);
    expect(second.id).toBe(first.id);

    const expenses = await prisma.expense.findMany({ where: { transactionId: txn.id } });
    expect(expenses).toHaveLength(1);
  });

  it("refuses to turn a deposit (negative amountCents) into an expense", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);
    const deposit = await createTestTransaction(business.id, account.id, { amountCents: -5000 });

    await expect(confirmExpenseFromTransaction(business.id, deposit.id, category.id)).rejects.toThrow(
      InvalidTransactionError,
    );
  });

  it("cannot reconcile a transaction belonging to a different business (tenant isolation)", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const accountA = await createTestFinancialAccount(businessA.id);
    const categoryB = await expenseCategory(businessB.id);
    const txnA = await createTestTransaction(businessA.id, accountA.id);

    await expect(confirmExpenseFromTransaction(businessB.id, txnA.id, categoryB.id)).rejects.toThrow(
      ForbiddenError,
    );
  });

  it("ignoring a transaction removes it from the review queue and cannot then be reconciled", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);
    const txn = await createTestTransaction(business.id, account.id);

    await ignoreTransaction(business.id, txn.id);
    const items = await listTransactionsNeedingReview(business.id);
    expect(items.find((i) => i.transaction.id === txn.id)).toBeUndefined();

    await expect(confirmExpenseFromTransaction(business.id, txn.id, category.id)).rejects.toThrow(
      InvalidTransactionError,
    );
  });
});

describe("invoice payment matching", () => {
  async function sentInvoice(businessId: string, totalCents: number, customerName = "Jordan Rivera") {
    const customer = await createTestCustomer(businessId, customerName);
    const invoice = await createInvoice({
      businessId,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 7),
      taxCents: 0,
      lineItems: [{ description: "Services", quantity: 1, unitPriceCents: totalCents }],
    });
    await markInvoiceSent(businessId, invoice.id);
    return { customer, invoice };
  }

  it("finds an exact-amount, date-proximate match and does not guess when ambiguous", async () => {
    const business = await createTestBusiness();
    const { invoice } = await sentInvoice(business.id, 184_000);

    const deposit = { amountCents: -184_000, postedDate: new Date(), merchantName: null, description: "ACH DEPOSIT" };
    const match = await findInvoiceMatch(business.id, deposit);
    expect(match?.invoiceId).toBe(invoice.id);

    // A second open invoice with the identical balance makes the amount
    // match ambiguous -- must not guess between them.
    await sentInvoice(business.id, 184_000);
    const ambiguous = await findInvoiceMatch(business.id, deposit);
    expect(ambiguous).toBeNull();
  });

  it("does not match on amount alone without date or name corroboration", async () => {
    const business = await createTestBusiness();
    await sentInvoice(business.id, 99_900);
    const staleDeposit = {
      amountCents: -99_900,
      postedDate: new Date(Date.now() - 400 * 86_400_000), // over a year off
      merchantName: null,
      description: "UNRELATED WIRE",
    };
    expect(await findInvoiceMatch(business.id, staleDeposit)).toBeNull();
  });

  it("confirmInvoicePayment reuses recordPayment (overpayment guard still applies) and links the transaction", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const { invoice } = await sentInvoice(business.id, 10_000);
    const deposit = await createTestTransaction(business.id, account.id, { amountCents: -10_000 });

    const payment = await confirmInvoicePayment(business.id, deposit.id, invoice.id);
    expect(payment.amountCents).toBe(10_000);
    expect(payment.transactionId).toBe(deposit.id);

    const updatedInvoice = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id } });
    expect(updatedInvoice.status).toBe("PAID");
  });

  it("is idempotent: confirming the same deposit twice never creates two Payments", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const { invoice } = await sentInvoice(business.id, 10_000);
    const deposit = await createTestTransaction(business.id, account.id, { amountCents: -10_000 });

    const first = await confirmInvoicePayment(business.id, deposit.id, invoice.id);
    const second = await confirmInvoicePayment(business.id, deposit.id, invoice.id);
    expect(second.id).toBe(first.id);

    const payments = await prisma.payment.findMany({ where: { transactionId: deposit.id } });
    expect(payments).toHaveLength(1);
  });

  it("still refuses an overpaying match (recordPayment's own guard is not bypassed)", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const { invoice } = await sentInvoice(business.id, 5_000);
    // A deposit larger than the invoice total would never legitimately
    // findInvoiceMatch to this invoice, but confirmInvoicePayment must
    // still be safe if called directly (e.g. a manually-forced match).
    const deposit = await createTestTransaction(business.id, account.id, { amountCents: -10_000 });

    await expect(confirmInvoicePayment(business.id, deposit.id, invoice.id)).rejects.toThrow(OverpaymentError);
  });

  it("cannot match a transaction or invoice belonging to a different business (tenant isolation)", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const accountA = await createTestFinancialAccount(businessA.id);
    const { invoice: invoiceB } = await sentInvoice(businessB.id, 7_500);
    const depositA = await createTestTransaction(businessA.id, accountA.id, { amountCents: -7_500 });

    // Cross-tenant transaction lookup fails first (transaction belongs to
    // A, caller claims B).
    await expect(confirmInvoicePayment(businessB.id, depositA.id, invoiceB.id)).rejects.toThrow(ForbiddenError);
  });
});

describe("review queue", () => {
  it("lists uncategorized expenses and unmatched deposits, excluding reconciled/ignored ones", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);

    const uncategorized = await createTestTransaction(business.id, account.id, { amountCents: 1500 });
    const deposit = await createTestTransaction(business.id, account.id, { amountCents: -2500 });
    const reconciled = await createTestTransaction(business.id, account.id, { amountCents: 3000 });
    await confirmExpenseFromTransaction(business.id, reconciled.id, category.id);

    const items = await listTransactionsNeedingReview(business.id);
    const ids = items.map((i) => i.transaction.id);
    expect(ids).toContain(uncategorized.id);
    expect(ids).toContain(deposit.id);
    expect(ids).not.toContain(reconciled.id);
  });

  it("tenant isolation: business B's review queue never includes business A's transactions", async () => {
    const businessA = await createTestBusiness();
    const businessB = await createTestBusiness();
    const accountA = await createTestFinancialAccount(businessA.id);
    await createTestTransaction(businessA.id, accountA.id);

    const itemsForB = await listTransactionsNeedingReview(businessB.id);
    expect(itemsForB).toHaveLength(0);
  });
});

describe("insight/forecast engines see reconciled transactions", () => {
  it("a reconciled Expense shows up in the expense-trend insight inputs and the forecast", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const category = await expenseCategory(business.id);
    await prisma.business.update({ where: { id: business.id }, data: { startingCashCents: 1_000_000 } });

    const txn = await createTestTransaction(business.id, account.id, { amountCents: 250_000 });
    await confirmExpenseFromTransaction(business.id, txn.id, category.id);

    // getAllInsights must not throw and the resulting Expense row must be
    // a real, queryable row under this business (the same table
    // getCashTrendInsight/getExpenseTrendInsight already read from).
    const insights = await getAllInsights(business.id);
    expect(Array.isArray(insights)).toBe(true);
    const storedExpense = await prisma.expense.findUniqueOrThrow({ where: { transactionId: txn.id } });
    expect(storedExpense.businessId).toBe(business.id);

    const forecast = await computeForecast(business.id, 30);
    // Starting cash minus the reconciled expense must be reflected —
    // proves computeForecast() is actually reading the Expense table live,
    // not some cached/manual-only view of it.
    expect(forecast.projectedCashCents).toBeLessThan(1_000_000);
  });

  it("a reconciled Payment shows up as real invoice/payment data the insight engine reads", async () => {
    const business = await createTestBusiness();
    const account = await createTestFinancialAccount(business.id);
    const customer = await createTestCustomer(business.id);
    const invoice = await createInvoice({
      businessId: business.id,
      customerId: customer.id,
      issueDate: new Date(),
      dueDate: new Date(Date.now() + 86_400_000 * 7),
      taxCents: 0,
      lineItems: [{ description: "x", quantity: 1, unitPriceCents: 12_000 }],
    });
    await markInvoiceSent(business.id, invoice.id);
    const deposit = await createTestTransaction(business.id, account.id, { amountCents: -12_000 });

    await confirmInvoicePayment(business.id, deposit.id, invoice.id);

    const updated = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { payments: true } });
    expect(updated.status).toBe("PAID");
    expect(updated.payments).toHaveLength(1);

    // getOverdueInvoicesInsight (and everything downstream) reads
    // Invoice.status directly -- a PAID invoice must no longer surface as
    // overdue/open.
    const insights = await getAllInsights(business.id);
    const overdueInsight = insights.find((i) => i.id === "overdue-invoices");
    expect(overdueInsight).toBeUndefined();
  });
});
