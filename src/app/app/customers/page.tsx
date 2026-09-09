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

      <div className="card divide-y divide-line">
        {customers.length === 0 && (
          <p className="p-8 text-center text-sm text-muted">No customers yet.</p>
        )}
        {customers.map((c) => (
          <div key={c.id} className="flex items-center justify-between px-5 py-3.5">
            <div>
              <p className="text-sm font-medium text-ink">{c.name}</p>
              {c.email && <p className="text-xs text-muted">{c.email}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
