import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { getCurrentCashCents, computeForecast } from "@/server/services/forecast";
import { getAllInsights } from "@/server/services/insights";
import { formatCents } from "@/lib/money";
import InsightCard from "@/components/InsightCard";

const confidenceCopy: Record<string, string> = {
  high: "High confidence",
  medium: "Medium confidence",
  low: "Low confidence — limited data",
};

export default async function DashboardPage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  const [cashCents, forecast, insights] = await Promise.all([
    getCurrentCashCents(business.id),
    computeForecast(business.id, 30),
    getAllInsights(business.id),
  ]);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">Overview</h1>
        <p className="mt-1 text-sm text-muted">Where things stand today.</p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="card p-6">
          <p className="kicker">Cash on hand</p>
          <p className="mt-2 text-[34px] font-semibold leading-none tracking-tight text-ink tabular-nums">
            {formatCents(cashCents)}
          </p>
          <p className="mt-2 text-xs text-muted">Right now, across your accounts on file.</p>
        </div>

        <div className="card p-6">
          <div className="flex items-baseline justify-between">
            <p className="kicker">In 30 days, projected</p>
            <span className="text-xs text-muted">{confidenceCopy[forecast.confidence]}</span>
          </div>
          <p className="mt-2 text-[34px] font-semibold leading-none tracking-tight text-ink tabular-nums">
            {formatCents(forecast.projectedCashCents)}
          </p>
          <dl className="mt-4 flex gap-5 text-xs">
            <div>
              <dt className="text-muted">Collections</dt>
              <dd className="font-medium tabular-nums text-good">
                +{formatCents(forecast.expectedReceivablesCents)}
              </dd>
            </div>
            <div>
              <dt className="text-muted">Expenses</dt>
              <dd className="font-medium tabular-nums text-bad">
                −{formatCents(forecast.expectedExpensesCents)}
              </dd>
            </div>
          </dl>
        </div>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold text-ink">What&apos;s worth knowing</h2>
        {insights.length === 0 ? (
          <div className="card p-8 text-center">
            <p className="text-sm text-muted">
              Nothing urgent right now. Add a few invoices and expenses and we&apos;ll start
              surfacing what matters here.
            </p>
          </div>
        ) : (
          <div className="space-y-2.5">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
