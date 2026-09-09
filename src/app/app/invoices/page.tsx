import Link from "next/link";
import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { balanceDueCents, isOverdue } from "@/server/services/invoices";
import { formatCents } from "@/lib/money";
import StatusChip from "@/components/StatusChip";

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
          <h1 className="font-serif text-[26px] tracking-tight text-ink">Invoices</h1>
          <p className="mt-1 text-sm text-muted">Track what you&apos;re owed.</p>
        </div>
        <Link href="/app/invoices/new" className="btn-primary">
          New invoice
        </Link>
      </div>

      {invoices.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-12 text-center">
          <p className="text-sm text-ink">No invoices yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Create your first invoice to start tracking what customers owe you — we&apos;ll
            handle the totals and flag anything overdue automatically.
          </p>
          <Link href="/app/invoices/new" className="btn-primary mt-4 inline-flex">
            New invoice
          </Link>
        </div>
      ) : (
      <div className="field-surface divide-y divide-line">
        {invoices.map((inv) => {
          const overdue = isOverdue(inv);
          return (
            <Link
              key={inv.id}
              href={`/app/invoices/${inv.id}`}
              className="flex items-center justify-between px-5 py-4 transition-colors hover:bg-canvas"
            >
              <div>
                <p className="text-sm font-medium text-ink">
                  {inv.number} <span className="text-muted">·</span> {inv.customer.name}
                </p>
                <p className="mt-0.5 text-xs text-muted">
                  Due {inv.dueDate.toLocaleDateString()}
                  {overdue && <span className="ml-1.5 font-medium text-bad">Overdue</span>}
                </p>
              </div>
              <div className="flex items-center gap-4">
                <span className="text-sm font-medium tabular-nums text-ink">
                  {formatCents(balanceDueCents(inv))}
                </span>
                <StatusChip status={inv.status} />
              </div>
            </Link>
          );
        })}
      </div>
      )}
    </div>
  );
}
