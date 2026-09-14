import "server-only";
import { prisma } from "@/lib/db";
import { addCents, formatCentsCompact } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import { amountPaidCents, balanceDueCents, isOverdue } from "@/server/services/invoices";
import { computeForecast } from "@/server/services/forecast";
import { countTransactionsNeedingReview } from "@/server/services/bank/reconciliation";

/**
 * INSIGHT ENGINE — this is the core differentiator, and it is 100%
 * deterministic arithmetic over real rows, not an LLM call. Every insight
 * distinguishes FACT / CALCULATION from RECOMMENDATION, and carries
 * `evidence` — the actual records a user can click into to verify the
 * claim. If we later add an LLM layer, its only job is turning this
 * structured object into friendlier prose — it must not be allowed to
 * invent numbers or conclusions of its own. See docs/ai-grounding.md.
 *
 * Each insight is structured as four distinct pieces (headline / why it
 * matters / grounding basis / action) rather than a flat title+paragraph,
 * so the UI can present it as a piece of analysis rather than a generic
 * alert card.
 */

export type InsightKind = "FACT" | "CALCULATION" | "RECOMMENDATION";
export type InsightSeverity = "critical" | "attention" | "info";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  /** The headline claim, e.g. "$3,040 is waiting on overdue invoices". */
  headline: string;
  /** One or two sentences of concrete explanation grounding the headline. */
  explanation: string;
  /** Why this is worth the owner's attention — the "so what". */
  why: string;
  /** A short basis statement for trust, e.g. "Based on 2 open invoices". */
  basis: string;
  /** Optional call to action — a navigation link. */
  action?: { label: string; href: string };
  /** Optional one-click workflow the UI can run without leaving the page
   * (Phase K) — a discriminated union so each insight that supports one
   * carries exactly the data its action needs, nothing looked up again.
   * Distinct from `action`: this performs a real side effect (e.g. sends
   * an email) rather than navigating. */
  quickAction?: InsightQuickAction;
  evidence: { type: string; id: string; label: string }[];
}

export type InsightQuickAction = { type: "send_invoice_reminder"; invoiceId: string; customerName: string };

export async function getOverdueInvoicesInsight(businessId: string): Promise<Insight | null> {
  const openInvoices = await prisma.invoice.findMany({
    where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID"] }, deletedAt: null },
    include: { payments: { where: { voidedAt: null } }, customer: true },
  });

  const overdue = openInvoices.filter((inv) => isOverdue(inv));
  if (overdue.length === 0) return null;

  const totalOverdueCents = addCents(...overdue.map((inv) => balanceDueCents(inv)));
  const oldest = [...overdue].sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0]!;
  const daysLate = Math.floor((Date.now() - oldest.dueDate.getTime()) / (24 * 60 * 60 * 1000));

  return {
    id: "overdue-invoices",
    kind: "FACT",
    severity: overdue.length >= 3 || totalOverdueCents > 500_000 ? "critical" : "attention",
    headline: `${formatUsd(totalOverdueCents)} is waiting on overdue invoices`,
    explanation: `${overdue.length} customer${overdue.length === 1 ? "" : "s"} ${overdue.length === 1 ? "is" : "are"} overdue. ${oldest.customer.name}'s ${formatUsd(balanceDueCents(oldest))} invoice is now ${daysLate} day${daysLate === 1 ? "" : "s"} late.`,
    why: "Collecting these would add meaningful cushion to your projected cash position.",
    basis: `Based on ${overdue.length} open invoice${overdue.length === 1 ? "" : "s"}`,
    action: { label: "Review invoices", href: "/app/invoices" },
    // Only offered when the oldest overdue customer actually has an email
    // on file — the reminder service itself is the single source of
    // truth for every other eligibility/rate-limit rule, this just avoids
    // showing a button that would immediately fail for a knowable reason.
    quickAction: oldest.customer.email
      ? { type: "send_invoice_reminder", invoiceId: oldest.id, customerName: oldest.customer.name }
      : undefined,
    evidence: overdue.map((inv) => ({
      type: "invoice",
      id: inv.id,
      label: `${inv.number} — ${inv.customer.name} — ${formatUsd(balanceDueCents(inv))}`,
    })),
  };
}

export async function getExpenseTrendInsight(businessId: string): Promise<Insight | null> {
  const now = new Date();
  const currentPeriodStart = startOfMonth(now);
  const trailingStart = new Date(currentPeriodStart.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [currentMonthExpenses, trailingExpenses] = await Promise.all([
    prisma.expense.findMany({
      where: { businessId, deletedAt: null, incurredAt: { gte: currentPeriodStart } },
    }),
    prisma.expense.findMany({
      where: {
        businessId,
        deletedAt: null,
        incurredAt: { gte: trailingStart, lt: currentPeriodStart },
      },
    }),
  ]);

  if (trailingExpenses.length === 0 || currentMonthExpenses.length === 0) return null;

  const currentTotal = addCents(...currentMonthExpenses.map((e) => e.amountCents));
  const trailingMonthlyAvg = addCents(...trailingExpenses.map((e) => e.amountCents)) / 3;
  if (trailingMonthlyAvg === 0) return null;

  const daysElapsedThisMonth = Math.max(
    1,
    Math.floor((now.getTime() - currentPeriodStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const projectedCurrentTotal = Math.round((currentTotal / daysElapsedThisMonth) * daysInMonth);

  const percentChange = ((projectedCurrentTotal - trailingMonthlyAvg) / trailingMonthlyAvg) * 100;
  if (Math.abs(percentChange) < 15) return null; // not worth surfacing as an insight

  const direction = percentChange > 0 ? "higher" : "lower";
  const roundedPct = Math.abs(Math.round(percentChange));

  return {
    id: "expense-trend",
    kind: "CALCULATION",
    severity: percentChange > 30 ? "attention" : "info",
    headline: `Spending is trending ${roundedPct}% ${direction} than usual`,
    explanation: `Projected for this month: ${formatUsd(projectedCurrentTotal)}, vs. a ${formatUsd(Math.round(trailingMonthlyAvg))}/month average over the prior 3 months.`,
    why:
      direction === "higher"
        ? "If this holds for the rest of the month, it will eat into your margin."
        : "That's cash staying in the business compared to your usual pace.",
    basis: `Based on ${daysElapsedThisMonth} day${daysElapsedThisMonth === 1 ? "" : "s"} of data so far this month`,
    action: { label: "View expenses", href: "/app/expenses" },
    evidence: currentMonthExpenses.slice(0, 10).map((e) => ({
      type: "expense",
      id: e.id,
      label: `${e.vendorName} — ${formatUsd(e.amountCents)}`,
    })),
  };
}

export async function getCashTrendInsight(businessId: string): Promise<Insight | null> {
  // Phase Q cleanup: this used to also fetch the business's
  // startingCashCents/startingCashAsOf here, but never actually read
  // either — dead code, an unnecessary query on every Overview load
  // (this insight is 1 of ~9 run concurrently in getAllInsights).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [recentPayments, recentExpenses] = await Promise.all([
    prisma.payment.findMany({
      where: { businessId, voidedAt: null, paidAt: { gte: thirtyDaysAgo } },
      select: { amountCents: true },
    }),
    prisma.expense.findMany({
      where: { businessId, deletedAt: null, incurredAt: { gte: thirtyDaysAgo } },
      select: { amountCents: true },
    }),
  ]);

  if (recentPayments.length === 0 && recentExpenses.length === 0) return null;

  const netCents =
    addCents(...recentPayments.map((p) => p.amountCents)) -
    addCents(...recentExpenses.map((e) => e.amountCents));
  const positive = netCents >= 0;

  return {
    id: "cash-trend-30d",
    kind: "CALCULATION",
    severity: positive ? "info" : "attention",
    headline: positive
      ? `You brought in ${formatUsd(netCents)} more than you spent this month`
      : `You spent ${formatUsd(Math.abs(netCents))} more than you brought in this month`,
    explanation: `${recentPayments.length} payment${recentPayments.length === 1 ? "" : "s"} received, ${recentExpenses.length} expense${recentExpenses.length === 1 ? "" : "s"} logged since ${formatDate(thirtyDaysAgo)}.`,
    why: positive
      ? "Your cash position is growing at your current pace."
      : "Sustained over several months, this pace would draw down your cash reserve.",
    basis: "Based on the last 30 days",
    evidence: [],
  };
}

/**
 * The headline "can I afford to keep going" warning. Reuses the same
 * deterministic forecast engine the /app/forecast page shows — this is not
 * a separate guess, it's the exact same number surfaced proactively so the
 * owner doesn't have to go looking for it. A RECOMMENDATION (not a FACT):
 * it's built on the forecast's own stated assumptions, which are carried
 * through rather than hidden.
 */
export async function getRunwayWarningInsight(businessId: string): Promise<Insight | null> {
  const forecast90 = await computeForecast(businessId, 90);
  if (forecast90.projectedCashCents >= 0) return null;

  // Find the earliest horizon (30/60/90) that's already projected negative,
  // so the headline is as specific as the data supports.
  const forecast30 = await computeForecast(businessId, 30);
  const forecast60 = await computeForecast(businessId, 60);
  const first = [forecast30, forecast60, forecast90].find((f) => f.projectedCashCents < 0)!;

  return {
    id: "runway-warning",
    kind: "RECOMMENDATION",
    severity: "critical",
    headline: `Projected to run short on cash within ${first.horizonDays} days`,
    explanation: `Projected cash on ${formatDate(new Date(first.targetDate))}: ${formatUsd(first.projectedCashCents)}.`,
    why: "Following up on overdue invoices or slowing non-essential spending now would change this trajectory.",
    basis:
      first.assumptions.length > 0
        ? first.assumptions[0]!
        : "Assumes recurring expenses stay the same and invoices collect at each customer's usual pace",
    action: { label: "See full forecast", href: "/app/forecast" },
    evidence: [],
  };
}

/**
 * Phase G closes the loop: a synced bank transaction that needs a category
 * pick or an invoice-match confirmation is exactly the kind of thing this
 * engine exists to surface — it's real, actionable, and otherwise invisible
 * (an unreviewed transaction never becomes an Expense/Payment, so it never
 * reaches any other insight or the forecast either).
 */
export async function getNeedsReviewInsight(businessId: string): Promise<Insight | null> {
  const count = await countTransactionsNeedingReview(businessId);
  if (count === 0) return null;

  return {
    id: "needs-review-transactions",
    kind: "FACT",
    severity: count >= 5 ? "attention" : "info",
    headline: `${count} bank transaction${count === 1 ? "" : "s"} need${count === 1 ? "s" : ""} your review`,
    explanation:
      "Fable found these in your connected accounts but isn't confident enough to categorize or match them to an invoice on its own.",
    why: "Until you review them they stay invisible to your insights and forecast — reviewing turns real bank activity into expenses and payments Fable can actually reason about.",
    basis: "Based on your connected bank accounts",
    action: { label: "Review transactions", href: "/app/bank" },
    evidence: [],
  };
}

/**
 * Revenue concentration risk: how much of the last 90 days' realized
 * revenue came from a single customer. Only fires with at least two
 * paying customers in the window — with just one, "100% from one
 * customer" is trivially true and tells the owner nothing they don't
 * already know.
 */
export async function getCustomerConcentrationInsight(businessId: string): Promise<Insight | null> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const payments = await prisma.payment.findMany({
    where: { businessId, voidedAt: null, paidAt: { gte: ninetyDaysAgo } },
    include: { invoice: { include: { customer: true } } },
  });
  if (payments.length === 0) return null;

  const totalsByCustomer = new Map<string, { name: string; cents: number }>();
  for (const p of payments) {
    const customer = p.invoice.customer;
    const entry = totalsByCustomer.get(customer.id) ?? { name: customer.name, cents: 0 };
    entry.cents = addCents(entry.cents, p.amountCents);
    totalsByCustomer.set(customer.id, entry);
  }
  if (totalsByCustomer.size < 2) return null;

  const totalCents = addCents(...[...totalsByCustomer.values()].map((v) => v.cents));
  const [topCustomerId, top] = [...totalsByCustomer.entries()].sort((a, b) => b[1].cents - a[1].cents)[0]!;
  const share = top.cents / totalCents;
  if (share < 0.5) return null;

  const pct = Math.round(share * 100);
  return {
    id: "customer-concentration",
    kind: "FACT",
    severity: share >= 0.75 ? "attention" : "info",
    headline: `${top.name} is ${pct}% of your revenue over the last 90 days`,
    explanation: `${formatUsd(top.cents)} of the ${formatUsd(totalCents)} you collected in the last 90 days came from one customer.`,
    why: "Losing this customer would hit disproportionately hard — worth having a plan B before you need one.",
    basis: `Based on payments from ${totalsByCustomer.size} customers over the last 90 days`,
    action: { label: "View customers", href: "/app/customers" },
    evidence: [{ type: "customer", id: topCustomerId, label: `${top.name} — ${formatUsd(top.cents)}` }],
  };
}

/**
 * Same trailing-average-vs-projected math as getExpenseTrendInsight, but
 * broken out per category so the headline can name WHERE the money is
 * going instead of just that spending overall is up. Both insights can
 * legitimately fire together — one is the aggregate "so what", this one is
 * the specific "why" — so this deliberately doesn't suppress itself when
 * the aggregate trend also fires.
 */
export async function getCategorySpendSpikeInsight(businessId: string): Promise<Insight | null> {
  const now = new Date();
  const currentPeriodStart = startOfMonth(now);
  const trailingStart = new Date(currentPeriodStart.getTime() - 90 * 24 * 60 * 60 * 1000);

  const [currentExpenses, trailingExpenses] = await Promise.all([
    prisma.expense.findMany({
      where: { businessId, deletedAt: null, incurredAt: { gte: currentPeriodStart } },
      include: { category: true },
    }),
    prisma.expense.findMany({
      where: { businessId, deletedAt: null, incurredAt: { gte: trailingStart, lt: currentPeriodStart } },
      include: { category: true },
    }),
  ]);
  if (currentExpenses.length === 0 || trailingExpenses.length === 0) return null;

  const daysElapsedThisMonth = Math.max(
    1,
    Math.floor((now.getTime() - currentPeriodStart.getTime()) / (24 * 60 * 60 * 1000)) + 1,
  );
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();

  const byCategory = new Map<string, { name: string; currentCents: number; trailingCents: number }>();
  for (const e of currentExpenses) {
    const entry = byCategory.get(e.categoryId) ?? { name: e.category.name, currentCents: 0, trailingCents: 0 };
    entry.currentCents = addCents(entry.currentCents, e.amountCents);
    byCategory.set(e.categoryId, entry);
  }
  for (const e of trailingExpenses) {
    const entry = byCategory.get(e.categoryId) ?? { name: e.category.name, currentCents: 0, trailingCents: 0 };
    entry.trailingCents = addCents(entry.trailingCents, e.amountCents);
    byCategory.set(e.categoryId, entry);
  }

  let worst: { id: string; name: string; pct: number; projectedCents: number; avgCents: number } | null = null;
  for (const [categoryId, v] of byCategory) {
    const monthlyAvgCents = v.trailingCents / 3;
    if (monthlyAvgCents < 5000) continue; // under $50/mo on average — too small to matter
    const projectedCents = Math.round((v.currentCents / daysElapsedThisMonth) * daysInMonth);
    const pct = ((projectedCents - monthlyAvgCents) / monthlyAvgCents) * 100;
    // A higher bar than the aggregate trend's 15% — a single category is
    // naturally noisier month to month, so this only fires for a real spike.
    if (pct < 40) continue;
    if (!worst || pct > worst.pct) worst = { id: categoryId, name: v.name, pct, projectedCents, avgCents: monthlyAvgCents };
  }
  if (!worst) return null;

  return {
    id: "category-spend-spike",
    kind: "CALCULATION",
    severity: worst.pct >= 100 ? "attention" : "info",
    headline: `${worst.name} spending is up ${Math.round(worst.pct)}% this month`,
    explanation: `Projected for this month: ${formatUsd(worst.projectedCents)}, vs. a ${formatUsd(Math.round(worst.avgCents))}/month average over the prior 3 months.`,
    why: "A single category driving the increase is easier to act on than a vague overall trend.",
    basis: `Based on ${daysElapsedThisMonth} day${daysElapsedThisMonth === 1 ? "" : "s"} of data so far this month`,
    action: { label: "View expenses", href: "/app/expenses" },
    evidence: currentExpenses
      .filter((e) => e.categoryId === worst!.id)
      .slice(0, 10)
      .map((e) => ({ type: "expense", id: e.id, label: `${e.vendorName} — ${formatUsd(e.amountCents)}` })),
  };
}

/**
 * Proactive, not reactive: what's coming due soon, before it's overdue.
 * Complements getOverdueInvoicesInsight (which only ever looks backward).
 */
export async function getUpcomingDueInvoicesInsight(businessId: string): Promise<Insight | null> {
  const now = new Date();
  const soon = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
  const invoices = await prisma.invoice.findMany({
    where: { businessId, status: { in: ["SENT", "PARTIALLY_PAID"] }, deletedAt: null, dueDate: { gte: now, lte: soon } },
    include: { payments: { where: { voidedAt: null } }, customer: true },
    orderBy: { dueDate: "asc" },
  });
  if (invoices.length === 0) return null;

  const totalCents = addCents(...invoices.map((inv) => balanceDueCents(inv)));
  const soonest = invoices[0]!;
  const daysUntil = Math.max(0, Math.ceil((soonest.dueDate.getTime() - now.getTime()) / (24 * 60 * 60 * 1000)));

  return {
    id: "upcoming-due-invoices",
    kind: "FACT",
    severity: "info",
    headline: `${formatUsd(totalCents)} is due from customers within the next 7 days`,
    explanation: `${invoices.length} invoice${invoices.length === 1 ? "" : "s"} come due soon. ${soonest.customer.name}'s ${formatUsd(balanceDueCents(soonest))} invoice is due in ${daysUntil} day${daysUntil === 1 ? "" : "s"}.`,
    why: "Knowing what's expected to land helps you plan near-term spending with more confidence.",
    basis: `Based on ${invoices.length} open invoice${invoices.length === 1 ? "" : "s"} due within 7 days`,
    action: { label: "View invoices", href: "/app/invoices" },
    evidence: invoices.map((inv) => ({
      type: "invoice",
      id: inv.id,
      label: `${inv.number} — ${inv.customer.name} — ${formatUsd(balanceDueCents(inv))}`,
    })),
  };
}

/**
 * Catches the same vendor + amount logged twice within a few days — a
 * classic real-world mistake (re-entering a CSV row, re-confirming a bank
 * transaction, a card charged twice). Works uniformly across every way an
 * Expense gets created (manual, CSV import, or bank reconciliation) since
 * Expense is the one canonical record regardless of origin. Deliberately a
 * FACT ("these two rows match"), not an accusation that either is wrong —
 * the owner decides.
 */
export async function getDuplicateExpenseInsight(businessId: string): Promise<Insight | null> {
  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const expenses = await prisma.expense.findMany({
    where: { businessId, deletedAt: null, incurredAt: { gte: ninetyDaysAgo } },
    orderBy: { incurredAt: "asc" },
  });
  if (expenses.length < 2) return null;

  const DUP_WINDOW_MS = 3 * 24 * 60 * 60 * 1000;
  for (let i = 0; i < expenses.length; i++) {
    for (let j = i + 1; j < expenses.length; j++) {
      const a = expenses[i]!;
      const b = expenses[j]!;
      // Sorted by date — once the gap exceeds the window, nothing further
      // out in this inner loop can match either, so stop scanning it.
      if (b.incurredAt.getTime() - a.incurredAt.getTime() > DUP_WINDOW_MS) break;
      if (a.vendorName === b.vendorName && a.amountCents === b.amountCents) {
        return {
          id: "possible-duplicate-expense",
          kind: "FACT",
          severity: "attention",
          headline: `Two ${formatUsd(a.amountCents)} charges to ${a.vendorName} within days of each other`,
          explanation: `Logged on ${formatDate(a.incurredAt)} and ${formatDate(b.incurredAt)} — worth a quick check that this isn't the same charge recorded twice.`,
          why: "A duplicated expense understates your real cash position and skews your spending trend.",
          basis: "Based on matching vendor and amount within 3 days",
          action: { label: "View expenses", href: "/app/expenses" },
          evidence: [
            { type: "expense", id: a.id, label: `${a.vendorName} — ${formatUsd(a.amountCents)} — ${formatDate(a.incurredAt)}` },
            { type: "expense", id: b.id, label: `${b.vendorName} — ${formatUsd(b.amountCents)} — ${formatDate(b.incurredAt)}` },
          ],
        };
      }
    }
  }
  return null;
}

export async function getAllInsights(businessId: string): Promise<Insight[]> {
  const results = await Promise.all([
    getRunwayWarningInsight(businessId),
    getOverdueInvoicesInsight(businessId),
    getExpenseTrendInsight(businessId),
    getCashTrendInsight(businessId),
    getNeedsReviewInsight(businessId),
    getCustomerConcentrationInsight(businessId),
    getCategorySpendSpikeInsight(businessId),
    getUpcomingDueInvoicesInsight(businessId),
    getDuplicateExpenseInsight(businessId),
  ]);
  return results.filter((i): i is Insight => i !== null);
}

const severityRank: Record<InsightSeverity, number> = { critical: 0, attention: 1, info: 2 };

export interface StatusSummary {
  /** The opening statement of the Overview narrative — deliberately terse
   * prose, not a "score". */
  headline: string;
  /** The single most important insight, meant to be woven into the page's
   * opening narrative rather than shown as a generic list item. */
  spotlight: Insight | null;
  /** Everything else, in severity order. */
  rest: Insight[];
}

/** Pure, deterministic, and unit-testable on its own: turns a set of
 * insights into the one sentence and the one fact that should lead the
 * Overview page, plus whatever's left for the "worth doing" list. */
export function summarizeInsights(insights: Insight[]): StatusSummary {
  if (insights.length === 0) {
    return { headline: "You're in a good position.", spotlight: null, rest: [] };
  }
  const sorted = [...insights].sort((a, b) => severityRank[a.severity] - severityRank[b.severity]);
  const [spotlight, ...rest] = sorted;
  const headline =
    spotlight!.severity === "critical"
      ? "You need to make a decision soon."
      : spotlight!.severity === "attention"
        ? "You're in a stable position, but a couple of things need attention."
        : "You're in a good position.";
  return { headline, spotlight: spotlight!, rest };
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatUsd(cents: number): string {
  return formatCentsCompact(cents);
}
