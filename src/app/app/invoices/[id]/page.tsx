import { notFound } from "next/navigation";
import { randomUUID } from "crypto";
import { requireMembership, requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { amountPaidCents, balanceDueCents, isOverdue } from "@/server/services/invoices";
import { formatCents } from "@/lib/money";
import RecordPaymentForm from "./RecordPaymentForm";
import SendInvoiceButton from "./SendInvoiceButton";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  // Tenant-scoped: the invoice must belong to a business this user has
  // active membership on. requireMembership already confirmed that above;
  // this query additionally scopes by businessId so the id in the URL can
  // never pull a record from a different tenant.
  await requireMembership(business.id);
  const invoice = await prisma.invoice.findFirst({
    where: { id: params.id, businessId: business.id, deletedAt: null },
    include: {
      customer: true,
      lineItems: true,
      payments: { orderBy: { paidAt: "desc" } },
    },
  });
  if (!invoice) notFound();

  const paid = amountPaidCents(invoice);
  const due = balanceDueCents(invoice);
  const overdue = isOverdue(invoice);

  return (
    <div className="max-w-2xl space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">
            {invoice.number} — {invoice.customer.name}
          </h1>
          <p className="text-sm text-slate-500">
            Due {invoice.dueDate.toLocaleDateString()}
            {overdue && <span className="ml-1 font-medium text-bad">· overdue</span>}
          </p>
        </div>
        {invoice.status === "DRAFT" && (
          <SendInvoiceButton businessId={business.id} invoiceId={invoice.id} />
        )}
      </div>

      <div className="rounded-lg border border-slate-200 bg-white p-5">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="pb-2">Description</th>
              <th className="pb-2 text-right">Qty</th>
              <th className="pb-2 text-right">Unit price</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {invoice.lineItems.map((li) => (
              <tr key={li.id}>
                <td className="py-2">{li.description}</td>
                <td className="py-2 text-right tabular-nums">{li.quantity}</td>
                <td className="py-2 text-right tabular-nums">{formatCents(li.unitPriceCents)}</td>
                <td className="py-2 text-right tabular-nums">{formatCents(li.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-right text-sm">
          <p>
            Subtotal <span className="ml-3 tabular-nums">{formatCents(invoice.subtotalCents)}</span>
          </p>
          <p>
            Tax <span className="ml-3 tabular-nums">{formatCents(invoice.taxCents)}</span>
          </p>
          <p className="font-semibold">
            Total <span className="ml-3 tabular-nums">{formatCents(invoice.totalCents)}</span>
          </p>
          <p className="text-good">
            Paid <span className="ml-3 tabular-nums">{formatCents(paid)}</span>
          </p>
          <p className="font-semibold text-ink">
            Balance due <span className="ml-3 tabular-nums">{formatCents(due)}</span>
          </p>
        </div>
      </div>

      {due > 0 && invoice.status !== "DRAFT" && invoice.status !== "VOID" && (
        <RecordPaymentForm
          businessId={business.id}
          invoiceId={invoice.id}
          maxDollars={due / 100}
          idempotencyKey={randomUUID()}
        />
      )}

      {invoice.payments.length > 0 && (
        <div>
          <h2 className="mb-2 text-sm font-medium text-slate-500">Payment history</h2>
          <ul className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex justify-between p-3 text-sm">
                <span>
                  {p.paidAt.toLocaleDateString()} · {p.method.replace("_", " ")}
                  {p.voidedAt && <span className="ml-2 text-bad">(voided)</span>}
                </span>
                <span className="tabular-nums">{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
