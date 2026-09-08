import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { computeForecast } from "@/server/services/forecast";
import { formatCents } from "@/lib/money";

export default async function ForecastPage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  const [f30, f60, f90] = await Promise.all([
    computeForecast(business.id, 30),
    computeForecast(business.id, 60),
    computeForecast(business.id, 90),
  ]);

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-xl font-semibold text-ink">Cash forecast</h1>
        <p className="text-sm text-slate-500">
          A conservative projection based on your open invoices and recurring expenses — not a
          guarantee.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[f30, f60, f90].map((f) => (
          <div key={f.horizonDays} className="rounded-lg border border-slate-200 bg-white p-5">
            <p className="text-sm text-slate-500">In {f.horizonDays} days</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums text-ink">
              {formatCents(f.projectedCashCents)}
            </p>
            <p className="mt-1 text-xs text-slate-400">
              {new Date(f.targetDate).toLocaleDateString()} · {f.confidence} confidence
            </p>
            <dl className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-slate-400">Starting cash</dt>
                <dd className="tabular-nums">{formatCents(f.currentCashCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">+ Expected collections</dt>
                <dd className="tabular-nums text-good">+{formatCents(f.expectedReceivablesCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-slate-400">− Expected expenses</dt>
                <dd className="tabular-nums text-bad">−{formatCents(f.expectedExpensesCents)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      {f90.assumptions.length > 0 && (
        <div className="rounded-lg border border-dashed border-slate-200 p-4">
          <p className="mb-2 text-sm font-medium text-slate-600">What this assumes</p>
          <ul className="space-y-1 text-sm text-slate-500">
            {f90.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
