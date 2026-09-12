import { notFound } from "next/navigation";
import { randomUUID } from "crypto";
import { requireMembership } from "@/server/tenant";
import { getActiveBusinessContext } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import { amountPaidCents, balanceDueCents, isOverdue } from "@/server/services/invoices";
import { formatCents } from "@/lib/money";
import StatusChip from "@/components/StatusChip";
import RecordPaymentForm from "./RecordPaymentForm";
import SendInvoiceButton from "./SendInvoiceButton";
import SendReminderButton from "./SendReminderButton";

export default async function InvoiceDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  // Tenant-scoped: the invoice must belong to a business this user has
  // active membership on. requireMembership already confirmed that above;
  // this query additionally scopes by businessId so the id in the URL can
  // never pull a record from a different tenant.
  await requireMembership(business.id);
  const invoice = await prisma.invoice.findFirst({
    where: { id, businessId: business.id, deletedAt: null },
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
          <h1 className="font-serif text-[26px] tracking-tight text-ink">
            {invoice.number} <span className="text-muted">·</span> {invoice.customer.name}
          </h1>
          <div className="mt-1.5 flex items-center gap-2 text-sm text-muted">
            <span>
              Due {invoice.dueDate.toLocaleDateString()}
              {overdue && <span className="ml-1.5 font-medium text-bad">Overdue</span>}
            </span>
            <span>·</span>
            <StatusChip status={invoice.status} />
          </div>
        </div>
        {invoice.status !== "VOID" && (
          <div className="flex flex-col items-end gap-2">
            <SendInvoiceButton
              businessId={business.id}
              invoiceId={invoice.id}
              customerHasEmail={!!invoice.customer.email}
              alreadySent={invoice.status !== "DRAFT"}
            />
            {(invoice.status === "SENT" || invoice.status === "PARTIALLY_PAID") && due > 0 && (
              <SendReminderButton
                businessId={business.id}
                invoiceId={invoice.id}
                // Formatted here, server-side, into a plain string — never
                // pass a raw Date into a client component to format with
                // .toLocaleDateString() at render time: the server's
                // locale and the browser's can format it differently,
                // which is a hydration mismatch, not just a display quirk.
                lastReminderSentAtLabel={invoice.lastReminderSentAt?.toLocaleDateString() ?? null}
              />
            )}
          </div>
        )}
      </div>

      <div className="field-surface p-6">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="pb-2 font-medium">Description</th>
              <th className="pb-2 text-right font-medium">Qty</th>
              <th className="pb-2 text-right font-medium">Unit price</th>
              <th className="pb-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {invoice.lineItems.map((li) => (
              <tr key={li.id}>
                <td className="py-2.5 text-ink">{li.description}</td>
                <td className="py-2.5 text-right tabular-nums text-ink">{li.quantity}</td>
                <td className="py-2.5 text-right tabular-nums text-ink">
                  {formatCents(li.unitPriceCents)}
                </td>
                <td className="py-2.5 text-right tabular-nums text-ink">
                  {formatCents(li.amountCents)}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-right text-sm">
          <p className="text-muted">
            Subtotal <span className="ml-3 tabular-nums text-ink">{formatCents(invoice.subtotalCents)}</span>
          </p>
          <p className="text-muted">
            Tax <span className="ml-3 tabular-nums text-ink">{formatCents(invoice.taxCents)}</span>
          </p>
          <p className="font-medium text-ink">
            Total <span className="ml-3 tabular-nums">{formatCents(invoice.totalCents)}</span>
          </p>
          <p className="text-good">
            Paid <span className="ml-3 tabular-nums">{formatCents(paid)}</span>
          </p>
          <p className="text-base font-semibold text-ink">
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
          <h2 className="mb-2 text-sm font-semibold text-ink">Payment history</h2>
          <ul className="field-surface divide-y divide-line">
            {invoice.payments.map((p) => (
              <li key={p.id} className="flex justify-between px-4 py-3 text-sm">
                <span className="text-muted">
                  {p.paidAt.toLocaleDateString()} · {p.method.replace("_", " ")}
                  {p.voidedAt && <span className="ml-2 text-bad">(voided)</span>}
                </span>
                <span className="font-medium tabular-nums text-ink">{formatCents(p.amountCents)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
