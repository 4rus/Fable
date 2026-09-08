import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { formatCents } from "@/lib/money";
import NewExpenseForm from "./NewExpenseForm";

export default async function ExpensesPage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

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
        <h1 className="text-xl font-semibold text-ink">Expenses</h1>
        <p className="text-sm text-slate-500">What&apos;s going out, and where.</p>
      </div>

      <NewExpenseForm businessId={business.id} categories={categories} />

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {expenses.length === 0 && <p className="p-5 text-sm text-slate-400">No expenses logged yet.</p>}
        {expenses.map((e) => (
          <div key={e.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium text-ink">{e.vendorName}</p>
              <p className="text-xs text-slate-400">
                {e.category.name} · {e.incurredAt.toLocaleDateString()}
                {e.isRecurring && " · recurring"}
              </p>
            </div>
            <span className="tabular-nums text-sm font-medium text-ink">
              {formatCents(e.amountCents)}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
