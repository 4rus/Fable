import type { Insight } from "@/server/services/insights";

/**
 * Severity is conveyed with a left accent bar and a filled dot, not a loud
 * full-width colored banner — the same visual language your bank's app
 * uses for a transaction alert, not a chatbot's "here's a tip!" callout.
 * `kind` (FACT/CALCULATION/RECOMMENDATION) still ships on every insight —
 * it's how we ground what's shown against real data (see insights.ts) —
 * but it's a small caption, not a pill demanding attention.
 */
const severityAccent: Record<Insight["severity"], string> = {
  info: "before:bg-slate-300",
  warning: "before:bg-warn",
  critical: "before:bg-bad",
};

const kindLabels: Record<Insight["kind"], string> = {
  FACT: "From your records",
  CALCULATION: "Calculated",
  RECOMMENDATION: "Projection",
};

export default function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div
      className={`card relative overflow-hidden pl-5 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:content-[''] ${severityAccent[insight.severity]}`}
    >
      <div className="px-4 py-4">
        <p className="text-[15px] font-medium leading-snug text-ink">{insight.title}</p>
        <p className="mt-1 text-[13px] leading-relaxed text-muted">{insight.detail}</p>

        <div className="mt-3 flex items-center gap-3">
          <span className="text-[11px] font-medium uppercase tracking-wide text-slate-400">
            {kindLabels[insight.kind]}
          </span>
          {insight.evidence.length > 0 && (
            <details className="group">
              <summary className="cursor-pointer text-[11px] font-medium text-accent marker:content-none">
                View {insight.evidence.length} record{insight.evidence.length === 1 ? "" : "s"}
              </summary>
              <ul className="mt-2 space-y-1 border-t border-line pt-2 text-xs text-muted">
                {insight.evidence.map((e) => (
                  <li key={e.id}>{e.label}</li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </div>
    </div>
  );
}
