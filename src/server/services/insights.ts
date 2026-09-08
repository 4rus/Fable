import "server-only";
import { prisma } from "@/lib/db";
import { addCents } from "@/lib/money";
import { amountPaidCents, balanceDueCents, isOverdue } from "@/server/services/invoices";

/**
 * INSIGHT ENGINE — this is the core differentiator, and it is 100%
 * deterministic arithmetic over real rows, not an LLM call. Every insight
 * distinguishes FACT / CALCULATION from RECOMMENDATION, and carries
 * `evidence` — the actual records a user can click into to verify the
 * claim. If we later add an LLM layer, its only job is turning this
 * structured object into friendlier prose — it must not be allowed to
 * invent numbers or conclusions of its own. See docs/ai-grounding.md.
 */

export type InsightKind = "FACT" | "CALCULATION" | "RECOMMENDATION";
export type InsightSeverity = "info" | "warning" | "critical";

export interface Insight {
  id: string;
  kind: InsightKind;
  severity: InsightSeverity;
  title: string;
  detail: string;
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
    severity: overdue.length >= 3 || totalOverdueCents > 500_000 ? "critical" : "warning",
    title: `${formatUsd(totalOverdueCents)} is overdue from ${overdue.length} customer${overdue.length === 1 ? "" : "s"}`,
    detail: `The oldest is a ${formatUsd(balanceDueCents(oldest))} invoice from ${oldest.customer.name}, ${daysLate} day${daysLate === 1 ? "" : "s"} late. Following up on the oldest overdue invoices tends to move fastest.`,
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

  return {
    id: "expense-trend",
    kind: "CALCULATION",
    severity: percentChange > 30 ? "warning" : "info",
    title: `Spending is trending ${Math.abs(Math.round(percentChange))}% ${direction} than your recent average`,
    detail: `Projected for this month: ${formatUsd(projectedCurrentTotal)}, vs. a ${formatUsd(Math.round(trailingMonthlyAvg))}/month average over the prior 3 months. This is a projection based on ${daysElapsedThisMonth} day${daysElapsedThisMonth === 1 ? "" : "s"} of data so far this month, not a final total.`,
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

  return {
    id: "cash-trend-30d",
    kind: "CALCULATION",
    severity: netCents < 0 ? "warning" : "info",
    title:
      netCents >= 0
        ? `You brought in ${formatUsd(netCents)} more than you spent in the last 30 days`
        : `You spent ${formatUsd(Math.abs(netCents))} more than you brought in over the last 30 days`,
    detail: `Based on ${recentPayments.length} payment${recentPayments.length === 1 ? "" : "s"} received and ${recentExpenses.length} expense${recentExpenses.length === 1 ? "" : "s"} logged since ${thirtyDaysAgo.toLocaleDateString()}.`,
    evidence: [],
  };
}

export async function getAllInsights(businessId: string): Promise<Insight[]> {
  const results = await Promise.all([
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
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(cents / 100);
}
