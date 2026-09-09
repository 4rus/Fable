import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { computeForecast } from "@/server/services/forecast";
import { formatCents } from "@/lib/money";

const confidenceCopy: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence",
};

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
        <h1 className="text-xl font-semibold tracking-tight text-ink">Cash forecast</h1>
        <p className="mt-1 text-sm text-muted">
          A conservative projection based on your open invoices and recurring expenses — not a
          guarantee.
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        {[f30, f60, f90].map((f) => (
          <div key={f.horizonDays} className="card p-6">
            <p className="kicker">In {f.horizonDays} days</p>
            <p
              className={`mt-2 text-[26px] font-semibold leading-none tracking-tight tabular-nums ${f.projectedCashCents < 0 ? "text-bad" : "text-ink"}`}
            >
              {formatCents(f.projectedCashCents)}
            </p>
            <p className="mt-2 text-xs text-muted">
              {new Date(f.targetDate).toLocaleDateString()} · {confidenceCopy[f.confidence]}
            </p>
            <dl className="mt-4 space-y-1.5 border-t border-line pt-3 text-xs">
              <div className="flex justify-between">
                <dt className="text-muted">Starting cash</dt>
                <dd className="tabular-nums text-ink">{formatCents(f.currentCashCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Collections</dt>
                <dd className="tabular-nums text-good">+{formatCents(f.expectedReceivablesCents)}</dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-muted">Expenses</dt>
                <dd className="tabular-nums text-bad">−{formatCents(f.expectedExpensesCents)}</dd>
              </div>
            </dl>
          </div>
        ))}
      </div>

      {f90.assumptions.length > 0 && (
        <div className="card p-5">
          <p className="mb-2 text-sm font-medium text-ink">What this assumes</p>
          <ul className="space-y-1 text-sm text-muted">
            {f90.assumptions.map((a, i) => (
              <li key={i}>· {a}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
