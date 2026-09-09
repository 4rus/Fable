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
        <h1 className="text-xl font-semibold tracking-tight text-ink">Expenses</h1>
        <p className="mt-1 text-sm text-muted">What&apos;s going out, and where.</p>
      </div>

      <NewExpenseForm businessId={business.id} categories={categories} />

      <div className="card divide-y divide-line">
        {expenses.length === 0 && (
          <p className="p-8 text-center text-sm text-muted">No expenses logged yet.</p>
        )}
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
    </div>
  );
}
