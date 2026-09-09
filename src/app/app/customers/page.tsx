import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import NewCustomerForm from "./NewCustomerForm";

export default async function CustomersPage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  const customers = await prisma.customer.findMany({
    where: { businessId: business.id, deletedAt: null },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Customers</h1>
        <p className="mt-1 text-sm text-muted">Who owes you money, and who might soon.</p>
      </div>

      <NewCustomerForm businessId={business.id} />

      {customers.length === 0 ? (
        <div className="rounded-xl border border-dashed border-line py-10 text-center">
          <p className="text-sm text-ink">No customers yet</p>
          <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
            Add the people and businesses you invoice — you&apos;ll need at least one before
            creating an invoice.
          </p>
        </div>
      ) : (
        <div className="card divide-y divide-line">
          {customers.map((c) => (
            <div key={c.id} className="flex items-center justify-between px-5 py-3.5">
              <div>
                <p className="text-sm font-medium text-ink">{c.name}</p>
                {c.email && <p className="text-xs text-muted">{c.email}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
