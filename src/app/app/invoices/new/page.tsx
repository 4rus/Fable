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
        <h1 className="text-xl font-semibold tracking-tight text-ink">New invoice</h1>
        <p className="mt-1 text-sm text-muted">
          Totals are calculated for you — you can&apos;t edit them directly.
        </p>
      </div>
      {customers.length === 0 ? (
        <div className="card p-8 text-center">
          <p className="text-sm text-muted">Add a customer first before creating an invoice.</p>
        </div>
      ) : (
        <NewInvoiceForm businessId={business.id} customers={customers} />
      )}
    </div>
  );
}
