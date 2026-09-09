import { requireUser } from "@/server/tenant";
import { getMyBusinesses } from "@/server/services/businesses";
import { getCurrentCashCents, computeForecast } from "@/server/services/forecast";
import { getAllInsights } from "@/server/services/insights";
import { formatCentsCompact, formatCentsDelta } from "@/lib/money";
import InsightList from "@/components/InsightList";

function greeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 18) return "Good afternoon";
  return "Good evening";
}

export default async function DashboardPage() {
  const { userId } = await requireUser();
  const businesses = await getMyBusinesses(userId);
  const business = businesses[0]!;

  const [cashCents, forecast, insights] = await Promise.all([
    getCurrentCashCents(business.id),
    computeForecast(business.id, 30),
    getAllInsights(business.id),
  ]);

  const netChangeCents = forecast.projectedCashCents - cashCents;
  const hasCriticalInsight = insights.some((i) => i.severity === "critical");

  return (
    <div className="space-y-10">
      <div>
        <h1 className="text-[22px] font-semibold tracking-tight text-ink">
          {greeting()}, {business.name}
        </h1>
        <p className="mt-1 text-sm text-muted">Here&apos;s what matters about your business today.</p>
      </div>

      {/* Primary financial status — one dominant number, not a grid of
          equally-weighted cards. Everything else is supporting context. */}
      <section>
        <p className="text-sm text-muted">Cash available</p>
        <div className="mt-1 flex items-baseline gap-3">
          <span className="text-[44px] font-semibold leading-none tracking-tight text-ink tabular-nums">
            {formatCentsCompact(cashCents)}
          </span>
        </div>
        <p className="mt-2 text-sm text-muted">
          {hasCriticalInsight ? (
            <span className="font-medium text-bad">Action needed — see below.</span>
          ) : netChangeCents >= 0 ? (
            <>Trending toward {formatCentsCompact(forecast.projectedCashCents)} over the next 30 days.</>
          ) : (
            <>Trending down to {formatCentsCompact(forecast.projectedCashCents)} over the next 30 days.</>
          )}
        </p>

        <dl className="mt-6 grid grid-cols-3 gap-3 divide-x divide-line border-t border-line pt-5 sm:gap-0">
          <div className="pr-2 sm:pr-4">
            <dt className="text-xs text-muted">Expected in</dt>
            <dd className="mt-1 whitespace-nowrap text-base font-medium tabular-nums text-ink sm:text-lg">
              {formatCentsDelta(forecast.expectedReceivablesCents)}
            </dd>
          </div>
          <div className="px-2 sm:px-4">
            <dt className="text-xs text-muted">Expected out</dt>
            <dd className="mt-1 whitespace-nowrap text-base font-medium tabular-nums text-ink sm:text-lg">
              {formatCentsDelta(-forecast.expectedExpensesCents)}
            </dd>
          </div>
          <div className="pl-2 sm:pl-4">
            <dt className="text-xs text-muted">Net</dt>
            <dd
              className={`mt-1 whitespace-nowrap text-base font-medium tabular-nums sm:text-lg ${netChangeCents >= 0 ? "text-good" : "text-bad"}`}
            >
              {formatCentsDelta(netChangeCents)}
            </dd>
          </div>
        </dl>
      </section>

      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-ink">Worth knowing</h2>
        <InsightList insights={insights} />
      </section>
    </div>
  );
}
