import { getActiveBusinessContext } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import NewExpenseForm from "./NewExpenseForm";

export default async function ExpensesPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const [expenses, categories] = await Promise.all([
    prisma.expense.findMany({
      where: { businessId: business.id, deletedAt: null },
      include: { category: true },
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
      <div>
        <h1 className="font-serif text-[26px] tracking-tight text-ink">Expenses</h1>
        <p className="mt-1 text-sm text-muted">What&apos;s going out, and where.</p>
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
            <div key={e.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-ink">{e.vendorName}</p>
                <p className="mt-0.5 text-xs text-muted">
                  {e.category.name} · {e.incurredAt.toLocaleDateString()}
                  {e.isRecurring && " · recurring"}
                </p>
              </div>
              <span className="text-sm font-medium tabular-nums text-ink">
                {formatCents(e.amountCents)}
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
