import Link from "next/link";
import { getActiveBusinessContext } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import NewExpenseForm from "./NewExpenseForm";
import ExpenseAttachments from "./ExpenseAttachments";

export default async function ExpensesPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const [expenses, categories] = await Promise.all([
    prisma.expense.findMany({
      where: { businessId: business.id, deletedAt: null },
      include: { category: true, attachments: { orderBy: { createdAt: "desc" } } },
      orderBy: { incurredAt: "desc" },
      take: 100,
    }),
    prisma.category.findMany({
      where: { businessId: business.id, type: "EXPENSE" },
      orderBy: { name: "asc" },
    }),
  ]);

  return (
    <div className="space-y-8">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="font-serif text-[26px] tracking-tight text-ink">Expenses</h1>
          <p className="mt-1 text-sm text-muted">What&apos;s going out, and where.</p>
        </div>
        <Link href="/app/expenses/import" className="btn-secondary">
          Import from CSV
        </Link>
      </div>

      <NewExpenseForm businessId={business.id} categories={categories} />

      {expenses.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-10 text-center">
          <p className="text-sm text-ink">No expenses logged yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Log what&apos;s going out — mark the recurring ones so we can factor them into your
            cash forecast.
          </p>
        </div>
      ) : (
        <div className="field-surface divide-y divide-line">
          {expenses.map((e) => (
            <div key={e.id} className="px-5 py-3.5">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium text-ink">{e.vendorName}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {e.category.name} · {formatDate(e.incurredAt)}
                    {e.isRecurring && " · recurring"}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums text-ink">
                  {formatCents(e.amountCents)}
                </span>
              </div>
              <ExpenseAttachments
                businessId={business.id}
                expenseId={e.id}
                attachments={e.attachments.map((a) => ({ id: a.id, filename: a.filename }))}
              />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
