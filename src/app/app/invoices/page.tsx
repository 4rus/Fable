import Link from "next/link";
import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { balanceDueCents, isOverdue } from "@/server/services/invoices";
import { formatCents } from "@/lib/money";

const statusStyles: Record<string, string> = {
  DRAFT: "bg-slate-100 text-slate-600",
  SENT: "bg-blue-50 text-accent",
  PARTIALLY_PAID: "bg-amber-50 text-warn",
  PAID: "bg-green-50 text-good",
  VOID: "bg-slate-100 text-slate-400 line-through",
};

export default async function InvoicesPage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  const invoices = await prisma.invoice.findMany({
    where: { businessId: business.id, deletedAt: null },
    include: { customer: true, payments: { where: { voidedAt: null } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">Invoices</h1>
          <p className="text-sm text-slate-500">Track what you&apos;re owed.</p>
        </div>
        <Link
          href="/app/invoices/new"
          className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-blue-700"
        >
          New invoice
        </Link>
      </div>

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {invoices.length === 0 && <p className="p-5 text-sm text-slate-400">No invoices yet.</p>}
        {invoices.map((inv) => {
          const overdue = isOverdue(inv);
          return (
            <Link
              key={inv.id}
              href={`/app/invoices/${inv.id}`}
              className="flex items-center justify-between p-4 hover:bg-slate-50"
            >
              <div>
                <p className="font-medium text-ink">
                  {inv.number} — {inv.customer.name}
                </p>
                <p className="text-xs text-slate-400">
                  Due {inv.dueDate.toLocaleDateString()}
                  {overdue && <span className="ml-1 font-medium text-bad">· overdue</span>}
                </p>
              </div>
              <div className="flex items-center gap-3">
                <span className="tabular-nums text-sm text-ink">
                  {formatCents(balanceDueCents(inv))} due
                </span>
                <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${statusStyles[inv.status]}`}>
                  {inv.status.replace("_", " ").toLowerCase()}
                </span>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
