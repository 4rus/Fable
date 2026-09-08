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
        <h1 className="text-xl font-semibold text-ink">Customers</h1>
        <p className="text-sm text-slate-500">Who owes you money, and who might soon.</p>
      </div>

      <NewCustomerForm businessId={business.id} />

      <div className="divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        {customers.length === 0 && (
          <p className="p-5 text-sm text-slate-400">No customers yet.</p>
        )}
        {customers.map((c) => (
          <div key={c.id} className="flex items-center justify-between p-4">
            <div>
              <p className="font-medium text-ink">{c.name}</p>
              {c.email && <p className="text-sm text-slate-500">{c.email}</p>}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
