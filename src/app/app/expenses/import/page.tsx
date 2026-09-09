import { getActiveBusinessContext } from "@/server/services/businesses";
import { prisma } from "@/lib/db";
import ImportForm from "./ImportForm";

export default async function ImportExpensesPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const categories = await prisma.category.findMany({
    where: { businessId: business.id, type: "EXPENSE" },
    orderBy: { name: "asc" },
  });

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="font-serif text-[26px] tracking-tight text-ink">Import expenses</h1>
        <p className="mt-1 text-sm text-muted">
          Upload a bank or card statement CSV. We&apos;ll only import the money going out —
          deposits need to be matched to the right invoice by hand on the Invoices page, so we
          never guess which customer a payment came from.
        </p>
      </div>
      <ImportForm businessId={business.id} categories={categories} />
    </div>
  );
}
