import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import NewInvoiceForm from "./NewInvoiceForm";

export default async function NewInvoicePage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  const customers = await prisma.customer.findMany({
    where: { businessId: business.id, deletedAt: null },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">New invoice</h1>
        <p className="text-sm text-slate-500">Totals are calculated for you — you can&apos;t edit them directly.</p>
      </div>
      {customers.length === 0 ? (
        <p className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-500">
          Add a customer first before creating an invoice.
        </p>
      ) : (
        <NewInvoiceForm businessId={business.id} customers={customers} />
      )}
    </div>
  );
}
