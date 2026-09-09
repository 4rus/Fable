import "server-only";
import { prisma } from "@/lib/db";
import { addCents, formatCentsCompact } from "@/lib/money";
import { amountPaidCents, balanceDueCents, isOverdue } from "@/server/services/invoices";
import { computeForecast } from "@/server/services/forecast";

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
  /** Optional call to action. */
  action?: { label: string; href: string };
  evidence: { type: string; id: string; label: string }[];
}

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
  const business = await prisma.business.findUniqueOrThrow({
    where: { id: businessId },
    select: { startingCashCents: true, startingCashAsOf: true },
  });
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
    explanation: `${recentPayments.length} payment${recentPayments.length === 1 ? "" : "s"} received, ${recentExpenses.length} expense${recentExpenses.length === 1 ? "" : "s"} logged since ${thirtyDaysAgo.toLocaleDateString()}.`,
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
    explanation: `Projected cash on ${new Date(first.targetDate).toLocaleDateString()}: ${formatUsd(first.projectedCashCents)}.`,
    why: "Following up on overdue invoices or slowing non-essential spending now would change this trajectory.",
    basis:
      first.assumptions.length > 0
        ? first.assumptions[0]!
        : "Assumes recurring expenses stay the same and invoices collect at each customer's usual pace",
    action: { label: "See full forecast", href: "/app/forecast" },
    evidence: [],
  };
}

export async function getAllInsights(businessId: string): Promise<Insight[]> {
  const results = await Promise.all([
    getRunwayWarningInsight(businessId),
    getOverdueInvoicesInsight(businessId),
    getExpenseTrendInsight(businessId),
    getCashTrendInsight(businessId),
  ]);
  return results.filter((i): i is Insight => i !== null);
}

function startOfMonth(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), 1);
}

function formatUsd(cents: number): string {
  return formatCentsCompact(cents);
}
