/**
 * A static, illustrative rendition of the actual Overview screen
 * (src/app/app/page.tsx) — same tokens, same layout logic, same tone of
 * copy the real insight engine produces (see src/server/services/
 * insights.ts). It is clearly labeled as an illustration with sample
 * figures, not a live account, but every visual decision mirrors the real
 * product exactly so this is not a "fake dashboard" invented for
 * marketing.
 */
export default function ProductPreview() {
  const trajectory = [
    { label: "Today", value: "$18,240" },
    { label: "30 days", value: "$21,900" },
    { label: "90 days", value: "$26,150" },
  ];

  return (
    <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-card">
      <div className="flex items-center gap-1.5 border-b border-line px-5 py-3">
        <span className="h-2.5 w-2.5 rounded-full bg-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-line" />
        <span className="h-2.5 w-2.5 rounded-full bg-line" />
        <span className="ml-3 text-xs text-muted">Overview — illustrative sample data</span>
      </div>

      <div className="space-y-10 px-6 py-8 sm:px-10 sm:py-10">
        <div>
          <p className="text-xs text-muted">Rivergate Cleaning Co. · Monday, September 14</p>
          <p className="mt-4 font-serif text-xl leading-snug tracking-tight text-ink sm:text-2xl">
            You&apos;re in a solid position, but cash is tighter than it looks.
          </p>
          <p className="mt-2 font-serif text-[15px] tabular-nums leading-none text-muted">
            <span className="text-[44px] font-medium leading-none tracking-tight text-ink sm:text-[52px]">
              $18,240
            </span>{" "}
            available today
          </p>
          <p className="mt-4 max-w-lg text-[15px] leading-relaxed text-ink">
            But{" "}
            <span className="underline decoration-line underline-offset-4">
              $6,400 is waiting on two overdue invoices
            </span>
            . Collecting these would add meaningful cushion before next month&apos;s supplier payment.
          </p>
        </div>

        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-muted">Here&apos;s what changed</p>
          <div className="mt-4 flex items-end justify-between border-b border-line pb-4">
            {trajectory.map((t) => (
              <div key={t.label}>
                <p className="text-xs text-muted">{t.label}</p>
                <p className="mt-1 font-serif text-xl tracking-tight tabular-nums text-ink sm:text-2xl">
                  {t.value}
                </p>
              </div>
            ))}
          </div>
        </div>

        <div>
          <p className="font-serif text-lg tracking-tight text-ink">3 things worth doing today</p>
          <ul className="mt-4 space-y-3">
            <li className="flex items-start justify-between gap-4 border-b border-line pb-3 text-sm">
              <span className="text-ink">Supply spending is up 18% this month, mainly from three purchases</span>
              <span className="whitespace-nowrap text-xs text-muted">Review</span>
            </li>
            <li className="flex items-start justify-between gap-4 border-b border-line pb-3 text-sm">
              <span className="text-ink">Riverside Property Group is 12 days late on a $2,150 invoice</span>
              <span className="whitespace-nowrap text-xs text-muted">Send reminder</span>
            </li>
            <li className="flex items-start justify-between gap-4 text-sm">
              <span className="text-ink">Projected cash dips below $4,000 before your next payroll run</span>
              <span className="whitespace-nowrap text-xs text-muted">See forecast</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
