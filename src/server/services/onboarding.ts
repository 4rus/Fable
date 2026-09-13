import "server-only";
import { prisma } from "@/lib/db";

/**
 * ONBOARDING STATUS (Phase N) — deterministic, evidence-backed, same
 * philosophy as insights.ts: every field here is either a direct fact
 * about real rows or an explicit user action, never a guess.
 *
 * Design: most of this needs no stored state at all — "has a customer",
 * "has an invoice", "has an expense", "bank connected" are all derived
 * live from real data. Two things genuinely can't be derived and need
 * their own column on Business (see schema.prisma's Phase N comment):
 * explicitly skipping the guided setup screen, and explicitly confirming
 * a starting cash balance (including confirming it's genuinely $0, which
 * looks identical to "never touched" without a separate flag).
 *
 * `isComplete` gates whether `/app` redirects a business to the one-time
 * guided `/app/setup` screen at all — once true, it's done forever (skip
 * counts as done; real data existing counts as done). Individual
 * `steps[].done` flags remain independently meaningful afterward, driving
 * the persistent checklist on the Overview page for whichever steps a
 * business skipped or hasn't gotten to yet.
 */

export interface OnboardingStep {
  id: "bank" | "startingCash" | "customerAndInvoice" | "expense";
  label: string;
  done: boolean;
  href: string;
}

export interface OnboardingStatus {
  bankConnected: boolean;
  hasCustomer: boolean;
  hasInvoice: boolean;
  hasExpense: boolean;
  startingCashConfirmed: boolean;
  skipped: boolean;
  /** Whether the business has exited the one-time guided setup screen —
   * via skipping it, or by already having real data of any kind (e.g. a
   * team member did setup, or data was imported). Does not mean every
   * individual step is done — see `steps`. */
  isComplete: boolean;
  /** Ordered, only the steps still outstanding — empty once everything
   * that matters is done. */
  steps: OnboardingStep[];
}

export async function getOnboardingStatus(businessId: string): Promise<OnboardingStatus> {
  const [business, bankConnectionCount, customerCount, invoiceCount, expenseCount] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: { onboardingSkippedAt: true, startingCashConfirmedAt: true },
    }),
    prisma.bankConnection.count({ where: { businessId, status: "ACTIVE" } }),
    prisma.customer.count({ where: { businessId } }),
    prisma.invoice.count({ where: { businessId, deletedAt: null } }),
    prisma.expense.count({ where: { businessId, deletedAt: null } }),
  ]);

  const bankConnected = bankConnectionCount > 0;
  const hasCustomer = customerCount > 0;
  const hasInvoice = invoiceCount > 0;
  const hasExpense = expenseCount > 0;
  const startingCashConfirmed = business.startingCashConfirmedAt !== null;
  const skipped = business.onboardingSkippedAt !== null;

  const isComplete = skipped || bankConnected || hasInvoice || hasExpense || startingCashConfirmed;

  const allSteps: OnboardingStep[] = [
    { id: "bank", label: "Connect your bank", done: bankConnected, href: "/app/bank" },
    {
      id: "startingCash",
      label: "Set your starting cash balance",
      done: startingCashConfirmed,
      href: "/app/settings/business",
    },
    {
      id: "customerAndInvoice",
      label: "Add your first customer and invoice",
      done: hasCustomer && hasInvoice,
      href: "/app/customers",
    },
    { id: "expense", label: "Log an expense", done: hasExpense, href: "/app/expenses" },
  ];

  return {
    bankConnected,
    hasCustomer,
    hasInvoice,
    hasExpense,
    startingCashConfirmed,
    skipped,
    isComplete,
    steps: allSteps.filter((s) => !s.done),
  };
}

/**
 * The two mutations behind onboarding's UX state, factored out of the
 * "use server" actions that call them (src/server/actions/onboarding.ts)
 * so they're directly unit-testable — those actions also call
 * `redirect()`/`revalidatePath()`, which need a real Next.js request
 * context and can't run under Vitest. Same split as
 * src/server/services/bank/reconciliation.ts: the service trusts
 * `businessId` as already-authorized (the action layer's job, via
 * requireMembership/requireOwner), and only touches that business's own
 * row.
 */
export async function skipOnboarding(businessId: string): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { onboardingSkippedAt: new Date() },
  });
}

export async function confirmStartingCash(
  businessId: string,
  cents: number,
  asOfDate: Date,
): Promise<void> {
  await prisma.business.update({
    where: { id: businessId },
    data: { startingCashCents: cents, startingCashAsOf: asOfDate, startingCashConfirmedAt: new Date() },
  });
}
