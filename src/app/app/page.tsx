import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { getCurrentCashCents, computeForecast } from "@/server/services/forecast";
import { getAllInsights } from "@/server/services/insights";
import { formatCents } from "@/lib/money";
import InsightCard from "@/components/InsightCard";

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
    <div className="space-y-8">
      <section>
        <p className="text-sm text-slate-500">Cash on hand right now</p>
        <p className="mt-1 text-4xl font-semibold tabular-nums text-ink">
          {formatCents(cashCents)}
        </p>
      </section>

      <section className="rounded-lg border border-slate-200 bg-white p-5">
        <div className="flex items-baseline justify-between">
          <h2 className="text-sm font-medium text-slate-500">In 30 days, we project</h2>
          <span
            className={
              "rounded-full px-2 py-0.5 text-xs font-medium " +
              (forecast.confidence === "high"
                ? "bg-green-50 text-good"
                : forecast.confidence === "medium"
                  ? "bg-amber-50 text-warn"
                  : "bg-slate-100 text-slate-500")
            }
          >
            {forecast.confidence} confidence
          </span>
        </div>
        <p className="mt-1 text-3xl font-semibold tabular-nums text-ink">
          {formatCents(forecast.projectedCashCents)}
        </p>
        <dl className="mt-4 grid grid-cols-3 gap-4 text-sm">
          <div>
            <dt className="text-slate-400">Starting cash</dt>
            <dd className="font-medium tabular-nums">{formatCents(forecast.currentCashCents)}</dd>
          </div>
          <div>
            <dt className="text-slate-400">+ Expected collections</dt>
            <dd className="font-medium tabular-nums text-good">
              +{formatCents(forecast.expectedReceivablesCents)}
            </dd>
          </div>
          <div>
            <dt className="text-slate-400">− Expected expenses</dt>
            <dd className="font-medium tabular-nums text-bad">
              −{formatCents(forecast.expectedExpensesCents)}
            </dd>
          </div>
        </dl>
        {forecast.assumptions.length > 0 && (
          <ul className="mt-4 space-y-1 border-t border-slate-100 pt-3 text-xs text-slate-500">
            {forecast.assumptions.map((a, i) => (
              <li key={i}>• {a}</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-medium text-slate-500">What&apos;s worth knowing</h2>
        {insights.length === 0 ? (
          <p className="rounded-lg border border-dashed border-slate-200 p-5 text-sm text-slate-400">
            Nothing urgent right now. Add a few invoices and expenses and we&apos;ll start
            surfacing what matters here.
          </p>
        ) : (
          <div className="space-y-3">
            {insights.map((insight) => (
              <InsightCard key={insight.id} insight={insight} />
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
