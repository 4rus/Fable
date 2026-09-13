import { prisma } from "@/lib/db";
import { getActiveBusinessContext } from "@/server/services/businesses";
import { centsToDollars } from "@/lib/money";
import StartingCashForm from "./StartingCashForm";

export default async function BusinessSettingsPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const full = await prisma.business.findUniqueOrThrow({
    where: { id: business.id },
    select: { startingCashCents: true, startingCashAsOf: true, startingCashConfirmedAt: true },
  });

  return (
    <div className="space-y-8">
      <div>
        <h1 className="font-serif text-[26px] tracking-tight text-ink">Business</h1>
        <p className="mt-1 text-sm text-muted">
          Your starting cash balance is the foundation every forecast and cash-position
          number in Fable builds on.
        </p>
      </div>

      <StartingCashForm
        businessId={business.id}
        initialAmount={centsToDollars(full.startingCashCents).toFixed(2)}
        // Plain server-formatted string, not a raw Date — see Phase K's
        // hydration-mismatch lesson (README/memory): never pass a Date
        // for a client component to format itself.
        initialAsOfDate={full.startingCashAsOf.toISOString().slice(0, 10)}
        confirmed={full.startingCashConfirmedAt !== null}
      />
    </div>
  );
}
