import { getActiveBusinessContext } from "@/server/services/businesses";
import { computeForecast, getCurrentCashCents, getUpcomingReceivables } from "@/server/services/forecast";
import { formatCentsCompact, formatCentsDelta } from "@/lib/money";

export default async function ForecastPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const [currentCash, f30, f60, f90, upcoming] = await Promise.all([
    getCurrentCashCents(business.id),
    computeForecast(business.id, 30),
    computeForecast(business.id, 60),
    computeForecast(business.id, 90),
    getUpcomingReceivables(business.id, 90),
  ]);

  const nodes = [
    { label: "Today", date: null as string | null, cents: currentCash, range: null as { lowCents: number; highCents: number } | null },
    { label: "30 days", date: f30.targetDate, cents: f30.projectedCashCents, range: f30.range },
    { label: "60 days", date: f60.targetDate, cents: f60.projectedCashCents, range: f60.range },
    { label: "90 days", date: f90.targetDate, cents: f90.projectedCashCents, range: f90.range },
  ];

  const dipsNegative = nodes.some((n) => n.cents < 0);

  return (
    <div className="space-y-10">
      <div>
        <h1 className="font-serif text-[26px] tracking-tight text-ink">Forecast</h1>
        <p className="mt-1 text-sm text-muted">
          {dipsNegative
            ? "Your projected cash dips below zero within 90 days — see when, below."
            : "Your projected cash stays positive over the next 90 days."}
        </p>
      </div>

      {/* Timeline — the forecast's real hierarchy is time, not four equal
          cards. Each node connects to the next so the trajectory reads at
          a glance. */}
      <section className="overflow-x-auto">
        <div className="flex min-w-[560px] items-start">
          {nodes.map((node, i) => (
            <div key={node.label} className="flex flex-1 items-start last:flex-none">
              <div className="flex flex-col items-start">
                <p className="text-xs text-muted">{node.label}</p>
                <p
                  className={`mt-1 text-2xl font-semibold tracking-tight tabular-nums ${node.cents < 0 ? "text-bad" : "text-ink"}`}
                >
                  {formatCentsCompact(node.cents)}
                </p>
                {node.date && (
                  <p className="mt-0.5 text-xs text-muted">
                    {new Date(node.date).toLocaleDateString(undefined, { month: "short", day: "numeric" })}
                  </p>
                )}
                {node.range && node.range.lowCents !== node.range.highCents && (
                  <p className="mt-0.5 text-xs tabular-nums text-muted">
                    {formatCentsCompact(node.range.lowCents)}–{formatCentsCompact(node.range.highCents)}
                  </p>
                )}
              </div>
              {i < nodes.length - 1 && (
                <div className="mt-4 flex flex-1 items-center px-3">
                  <div className="h-px w-full bg-line" />
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-line">
                    <path d="M9 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </div>
              )}
            </div>
          ))}
        </div>
      </section>

      {/* Drivers — inline stats, not another row of cards. */}
      <section className="grid grid-cols-2 gap-6 border-y border-line py-5 sm:grid-cols-2">
        <div>
          <p className="text-xs text-muted">Money coming in (90d)</p>
          <p className="mt-1 text-lg font-medium tabular-nums text-good">
            {formatCentsDelta(f90.expectedReceivablesCents)}
          </p>
        </div>
        <div>
          <p className="text-xs text-muted">Money going out (90d)</p>
          <p className="mt-1 text-lg font-medium tabular-nums text-bad">
            {formatCentsDelta(-f90.expectedExpensesCents)}
          </p>
        </div>
      </section>

      {f90.topDrivers.length > 0 && (
        <section>
          <h2 className="mb-3 text-[13px] font-semibold text-ink">What&apos;s driving this (90d)</h2>
          <ul className="divide-y divide-line rounded-xl border border-line">
            {f90.topDrivers.map((d, i) => (
              <li key={i} className="flex items-center justify-between px-5 py-3">
                <span className="text-sm text-ink">{d.label}</span>
                <span
                  className={`text-sm font-medium tabular-nums ${d.direction === "in" ? "text-good" : "text-bad"}`}
                >
                  {formatCentsDelta(d.direction === "in" ? d.amountCents : -d.amountCents)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section>
        <h2 className="mb-3 text-[13px] font-semibold text-ink">Expected invoice payments</h2>
        {upcoming.length === 0 ? (
          <p className="text-sm text-muted">No open invoices due within the next 90 days.</p>
        ) : (
          <div className="divide-y divide-line rounded-xl border border-line">
            {upcoming.map((e, i) => (
              <div key={i} className="flex items-center justify-between px-5 py-3">
                <div>
                  <p className="text-sm text-ink">{e.label}</p>
                  <p className="text-xs text-muted">
                    {new Date(e.date).toLocaleDateString()}
                    {e.overdue && <span className="ml-1.5 font-medium text-bad">Overdue</span>}
                  </p>
                </div>
                <span className="text-sm font-medium tabular-nums text-good">
                  +{formatCentsCompact(e.amountCents)}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {f90.assumptions.length > 0 && (
        <section>
          <h2 className="mb-2 text-[13px] font-semibold text-ink">What this assumes</h2>
          <ul className="space-y-1 text-sm text-muted">
            {f90.assumptions.map((a, i) => (
              <li key={i}>· {a}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
