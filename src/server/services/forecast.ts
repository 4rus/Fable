import "server-only";
import { prisma } from "@/lib/db";
import { addCents, subtractCents } from "@/lib/money";
import { amountPaidCents } from "@/server/services/invoices";

/**
 * DETERMINISTIC CASH FORECAST — no LLM involved anywhere in this file.
 *
 * Per the product thesis: a transparent, conservative forecast beats an
 * impressive-looking guess. Every number this produces must trace back to
 * rows in the database, and the breakdown it returns IS the explanation —
 * there is no separate "why" step that could drift from the math.
 *
 * Model (deliberately simple for v1 — documented, not hidden):
 *   projectedCash(horizon) =
 *       currentCash
 *     + expectedReceivables(horizon)   // open invoices, weighted by the
 *                                       // customer's own historical
 *                                       // on-time-payment rate
 *     - expectedRecurringExpenses(horizon) // avg of recurring expenses
 *                                           // over the trailing 3 months
 *
 * What this model deliberately does NOT do yet (documented gaps, not silent
 * ones): it does not model new/unbilled future revenue, seasonality, or
 * one-off future expenses the owner hasn't entered. Low-confidence inputs
 * are flagged in `assumptions` rather than smoothed over.
 */

export interface ForecastBreakdown {
  asOfDate: string;
  horizonDays: number;
  targetDate: string;
  currentCashCents: number;
  expectedReceivablesCents: number;
  expectedExpensesCents: number;
  projectedCashCents: number;
  confidence: "low" | "medium" | "high";
  assumptions: string[];
}

export async function getCurrentCashCents(businessId: string): Promise<number> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { startingCashCents: true, startingCashAsOf: true },
  });

  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: {
        businessId,
        voidedAt: null,
        paidAt: { gt: business.startingCashAsOf },
      },
      select: { amountCents: true },
    }),
    prisma.expense.findMany({
      where: {
        businessId,
        deletedAt: null,
        incurredAt: { gt: business.startingCashAsOf },
      },
      select: { amountCents: true },
    }),
  ]);

  const inflow = addCents(...payments.map((p) => p.amountCents));
  const outflow = addCents(...expenses.map((e) => e.amountCents));
  return addCents(business.startingCashCents, inflow) - outflow;
}

export async function computeForecast(
  businessId: string,
  horizonDays: 30 | 60 | 90,
): Promise<ForecastBreakdown> {
  const now = new Date();
  const targetDate = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);
  const assumptions: string[] = [];

  const currentCashCents = await getCurrentCashCents(businessId);

  // ── Expected receivables ────────────────────────────────────────────
  const openInvoices = await prisma.invoice.findMany({
    where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID"] }, deletedAt: null },
    include: { payments: { where: { voidedAt: null } }, customer: true },
  });

  // Per-customer historical on-time rate, from their fully-paid invoice
  // history: fraction of invoices whose last payment landed on/before
  // dueDate. Businesses with no history for a customer get a neutral 0.7
  // default weight rather than assuming certainty — see `assumptions`.
  const paymentRateCache = new Map<string, number | null>();

  let expectedReceivablesCents = 0;
  for (const inv of openInvoices) {
    const remaining = subtractCents(inv.totalCents, amountPaidCents(inv));
    if (remaining <= 0) continue;

    let rate = paymentRateCache.get(inv.customerId);
    if (rate === undefined) {
      rate = await customerOnTimeRate(businessId, inv.customerId);
      paymentRateCache.set(inv.customerId, rate);
    }
    if (rate === null) {
      assumptions.push(
        `${inv.customer.name} has no payment history — assumed a neutral 70% chance of collecting within this window.`,
      );
      rate = 0.7;
    }
    expectedReceivablesCents += Math.round(remaining * rate);
  }

  // ── Expected recurring expenses ─────────────────────────────────────
  const threeMonthsAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const recurring = await prisma.expense.findMany({
    where: {
      businessId,
      deletedAt: null,
      isRecurring: true,
      incurredAt: { gte: threeMonthsAgo },
    },
    select: { amountCents: true, incurredAt: true },
  });

  let expectedExpensesCents: number;
  if (recurring.length === 0) {
    expectedExpensesCents = 0;
    assumptions.push(
      "No recurring expenses are on file yet, so this forecast does not project any future spending — it will understate cash going out. Log recurring costs (rent, subscriptions, insurance) for a realistic number.",
    );
  } else {
    const monthlyAvg = addCents(...recurring.map((r) => r.amountCents)) / 3;
    expectedExpensesCents = Math.round(monthlyAvg * (horizonDays / 30));
  }

  const projectedCashCents = Math.round(
    currentCashCents + expectedReceivablesCents - expectedExpensesCents,
  );

  const confidence: ForecastBreakdown["confidence"] =
    openInvoices.length === 0 && recurring.length === 0
      ? "low"
      : assumptions.length === 0
        ? "high"
        : "medium";

  return {
    asOfDate: now.toISOString(),
    horizonDays,
    targetDate: targetDate.toISOString(),
    currentCashCents,
    expectedReceivablesCents,
    expectedExpensesCents,
    projectedCashCents,
    confidence,
    assumptions,
  };
}

/** Returns the fraction of a customer's past PAID invoices that were paid
 * on or before their due date, or `null` if there isn't enough history
 * (fewer than 1 fully-paid invoice) to say anything meaningful. */
export async function customerOnTimeRate(
  businessId: string,
  customerId: string,
): Promise<number | null> {
  const paidInvoices = await prisma.invoice.findMany({
    where: { businessId, customerId, status: "PAID", deletedAt: null },
    include: { payments: { where: { voidedAt: null }, orderBy: { paidAt: "desc" }, take: 1 } },
  });
  if (paidInvoices.length === 0) return null;

  const onTime = paidInvoices.filter((inv) => {
    const lastPayment = inv.payments[0];
    return lastPayment && lastPayment.paidAt <= inv.dueDate;
  }).length;

  return onTime / paidInvoices.length;
}

export interface UpcomingCashEvent {
  date: string;
  label: string;
  amountCents: number;
  direction: "in" | "out";
  overdue: boolean;
}

/**
 * Real, dated events within the horizon — open invoice due dates. We
 * deliberately do NOT synthesize future recurring-expense dates here: we
 * know the historical amount and cadence, not the actual future billing
 * date, and inventing one would violate the "never invent financial
 * information" rule. Recurring costs are represented in the forecast
 * total (computeForecast) but not as fabricated calendar events.
 */
export async function getUpcomingReceivables(
  businessId: string,
  horizonDays: number,
): Promise<UpcomingCashEvent[]> {
  const now = new Date();
  const horizonEnd = new Date(now.getTime() + horizonDays * 24 * 60 * 60 * 1000);

  const openInvoices = await prisma.invoice.findMany({
    where: {
      businessId,
      status: { in: ["SENT", "PARTIALLY_PAID"] },
      deletedAt: null,
      dueDate: { lte: horizonEnd },
    },
    include: { payments: { where: { voidedAt: null } }, customer: true },
    orderBy: { dueDate: "asc" },
  });

  return openInvoices
    .map((inv) => {
      const remaining = subtractCents(inv.totalCents, amountPaidCents(inv));
      return {
        date: inv.dueDate.toISOString(),
        label: `${inv.customer.name} — ${inv.number}`,
        amountCents: remaining,
        direction: "in" as const,
        overdue: inv.dueDate < now,
      };
    })
    .filter((e) => e.amountCents > 0);
}
