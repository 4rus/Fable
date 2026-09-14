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
  /** A deterministic best/worst-case band around `projectedCashCents` —
   * never a fabricated statistical confidence interval, just the two
   * honest edges of what the same real data supports: every open
   * invoice collecting in full (optimistic) vs. only customers with a
   * proven on-time history collecting anything at all (pessimistic), and
   * the lowest vs. highest of the last three 30-day recurring-spend
   * totals actually on file. `projectedCashCents` always falls inside
   * this range by construction — see computeForecast's comments. */
  range: { lowCents: number; highCents: number };
  confidence: "low" | "medium" | "high";
  assumptions: string[];
  /** The specific real rows behind the two totals above, sorted by
   * impact — the "why", not just the "what". A receivable driver is one
   * open invoice's expected contribution (remaining balance x that
   * customer's own on-time rate); an expense driver is one recurring
   * vendor's trailing monthly average. Never fabricated, never a
   * category that doesn't map to real rows. */
  topDrivers: ForecastDriver[];
}

export interface ForecastDriver {
  direction: "in" | "out";
  label: string;
  amountCents: number;
}

/**
 * Real bug found and fixed during Phase Q's final live walkthrough: a
 * brand-new business defaults `startingCashCents` to 0 and
 * `startingCashAsOf` to the EXACT business-creation timestamp (with a
 * time component, e.g. 2:46:29 PM). A payment recorded the same day
 * through the UI's date picker (`<input type="date">`) has no time
 * component and parses as UTC midnight — which is BEFORE 2:46:29 PM the
 * same day, so the old strict `paidAt > startingCashAsOf` filter
 * silently excluded it. Reproduced live: a brand-new signup recorded a
 * real $5,500 payment and the Overview page still showed "$0 available
 * today" right next to an insight saying "You brought in $5,500..." —
 * an internally inconsistent, confidence-destroying result for exactly
 * the moment (a new user's first action) it's most likely to happen and
 * most damaging to be wrong.
 *
 * The real fix isn't just "use >= instead of >": a `startingCashCents`
 * that was NEVER explicitly confirmed (see Business.startingCashConfirmedAt,
 * Phase N) isn't a real snapshot of anything — it's an untouched $0
 * placeholder, and there is nothing to avoid double-counting against, so
 * every payment/expense ever recorded should count, full stop. The
 * day-level exclusion only makes sense once a business has a REAL
 * confirmed starting balance "as of" a specific date — and even then,
 * the exclusion should cover that entire calendar day (not just the
 * exact second it was saved), since "as of Sep 14" means everything
 * already reflected in that balance happened on or before Sep 14, not
 * on or before the specific moment someone typed the number in.
 */
export async function getCurrentCashCents(businessId: string): Promise<number> {
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { startingCashCents: true, startingCashAsOf: true, startingCashConfirmedAt: true },
  });

  // No real snapshot exists yet — count everything, no cutoff at all.
  // A confirmed balance excludes its own entire calendar day (not just
  // the precise timestamp it happened to be saved at) — see comment above.
  const cutoff = business.startingCashConfirmedAt ? startOfNextDay(business.startingCashAsOf) : null;

  const [payments, expenses] = await Promise.all([
    prisma.payment.findMany({
      where: {
        businessId,
        voidedAt: null,
        ...(cutoff ? { paidAt: { gte: cutoff } } : {}),
      },
      select: { amountCents: true },
    }),
    prisma.expense.findMany({
      where: {
        businessId,
        deletedAt: null,
        ...(cutoff ? { incurredAt: { gte: cutoff } } : {}),
      },
      select: { amountCents: true },
    }),
  ]);

  const inflow = addCents(...payments.map((p) => p.amountCents));
  const outflow = addCents(...expenses.map((e) => e.amountCents));
  return addCents(business.startingCashCents, inflow) - outflow;
}

/** UTC, not local server time — `new Date("2026-09-14")` (what a
 * date-only `<input type="date">` produces) already parses as UTC
 * midnight, so this has to stay in the same UTC frame to correctly
 * represent "the day after that calendar day" regardless of which
 * timezone the server process itself happens to run in (dev machine vs.
 * Vercel, which run different timezones). */
function startOfNextDay(date: Date): Date {
  const next = new Date(date);
  next.setUTCHours(24, 0, 0, 0);
  return next;
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
  // default weight for the point estimate rather than assuming certainty
  // — see `assumptions`. The range's two edges don't use that neutral
  // default at all: the pessimistic edge counts nothing from an unproven
  // customer, the optimistic edge counts every open invoice in full.
  const paymentRateCache = new Map<string, number | null>();
  const receivableDrivers: ForecastDriver[] = [];

  let expectedReceivablesCents = 0;
  let receivablesLowCents = 0;
  let receivablesHighCents = 0;
  for (const inv of openInvoices) {
    const remaining = subtractCents(inv.totalCents, amountPaidCents(inv));
    if (remaining <= 0) continue;

    let rawRate = paymentRateCache.get(inv.customerId);
    if (rawRate === undefined) {
      rawRate = await customerOnTimeRate(businessId, inv.customerId);
      paymentRateCache.set(inv.customerId, rawRate);
    }

    receivablesHighCents = addCents(receivablesHighCents, remaining);
    receivablesLowCents = addCents(receivablesLowCents, Math.round(remaining * (rawRate ?? 0)));

    let pointRate = rawRate;
    if (pointRate === null) {
      assumptions.push(
        `${inv.customer.name} has no payment history — assumed a neutral 70% chance of collecting within this window.`,
      );
      pointRate = 0.7;
    }
    const contributionCents = Math.round(remaining * pointRate);
    expectedReceivablesCents = addCents(expectedReceivablesCents, contributionCents);
    receivableDrivers.push({
      direction: "in",
      label: `${inv.customer.name} — ${inv.number}`,
      amountCents: contributionCents,
    });
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
    select: { amountCents: true, incurredAt: true, vendorName: true },
  });

  let expectedExpensesCents: number;
  let expensesLowCents: number;
  let expensesHighCents: number;
  const expenseDrivers: ForecastDriver[] = [];

  if (recurring.length === 0) {
    expectedExpensesCents = 0;
    expensesLowCents = 0;
    expensesHighCents = 0;
    assumptions.push(
      "No recurring expenses are on file yet, so this forecast does not project any future spending — it will understate cash going out. Log recurring costs (rent, subscriptions, insurance) for a realistic number.",
    );
  } else {
    const horizonScale = horizonDays / 30;

    // Three rolling 30-day buckets (not calendar months — the 90-day
    // window itself is defined the same way) so the range has two real
    // observed data points to anchor to, not just their average.
    const buckets = [0, 0, 0];
    for (const r of recurring) {
      const daysAgo = (now.getTime() - r.incurredAt.getTime()) / (24 * 60 * 60 * 1000);
      const bucket = Math.min(2, Math.floor(daysAgo / 30));
      buckets[bucket] = addCents(buckets[bucket]!, r.amountCents);
    }
    const monthlyAvg = addCents(...buckets) / 3;
    expectedExpensesCents = Math.round(monthlyAvg * horizonScale);
    expensesLowCents = Math.round(Math.min(...buckets) * horizonScale);
    expensesHighCents = Math.round(Math.max(...buckets) * horizonScale);

    // Group by vendor for the driver list — one line per recurring cost,
    // not one per historical row.
    const byVendor = new Map<string, number>();
    for (const r of recurring) {
      byVendor.set(r.vendorName, addCents(byVendor.get(r.vendorName) ?? 0, r.amountCents));
    }
    for (const [vendorName, trailingTotalCents] of byVendor) {
      const monthlyCents = trailingTotalCents / 3;
      expenseDrivers.push({
        direction: "out",
        label: vendorName,
        amountCents: Math.round(monthlyCents * horizonScale),
      });
    }
  }

  const projectedCashCents = Math.round(
    currentCashCents + expectedReceivablesCents - expectedExpensesCents,
  );
  // By construction: receivablesLow <= expectedReceivables <= receivablesHigh
  // (rawRate ?? 0 <= pointRate <= 1 for every invoice), and expensesLow <=
  // expectedExpenses <= expensesHigh (monthlyAvg is the mean of the same
  // three buckets min/max is drawn from) — so the point estimate always
  // falls inside [lowCents, highCents], never outside its own range.
  const lowCents = Math.round(currentCashCents + receivablesLowCents - expensesHighCents);
  const highCents = Math.round(currentCashCents + receivablesHighCents - expensesLowCents);

  const confidence: ForecastBreakdown["confidence"] =
    openInvoices.length === 0 && recurring.length === 0
      ? "low"
      : assumptions.length === 0
        ? "high"
        : "medium";

  const topDrivers = [...receivableDrivers, ...expenseDrivers]
    .filter((d) => d.amountCents > 0)
    .sort((a, b) => b.amountCents - a.amountCents)
    .slice(0, 5);

  return {
    asOfDate: now.toISOString(),
    horizonDays,
    targetDate: targetDate.toISOString(),
    currentCashCents,
    expectedReceivablesCents,
    expectedExpensesCents,
    projectedCashCents,
    range: { lowCents, highCents },
    confidence,
    assumptions,
    topDrivers,
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
