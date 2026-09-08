import type { Insight } from "@/server/services/insights";

const severityStyles: Record<Insight["severity"], string> = {
  info: "border-slate-200 bg-white",
  warning: "border-amber-200 bg-amber-50",
  critical: "border-red-200 bg-red-50",
};

const kindLabels: Record<Insight["kind"], string> = {
  FACT: "Fact",
  CALCULATION: "Calculated",
  RECOMMENDATION: "Suggestion",
};

export default function InsightCard({ insight }: { insight: Insight }) {
  return (
    <div className={`rounded-lg border p-4 ${severityStyles[insight.severity]}`}>
      <div className="flex items-center gap-2">
        <span className="rounded bg-slate-900/5 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-slate-500">
          {kindLabels[insight.kind]}
        </span>
      </div>
      <p className="mt-1.5 font-medium text-ink">{insight.title}</p>
      <p className="mt-1 text-sm text-slate-600">{insight.detail}</p>
      {insight.evidence.length > 0 && (
        <details className="mt-2">
          <summary className="cursor-pointer text-xs font-medium text-accent">
            Show the {insight.evidence.length} record{insight.evidence.length === 1 ? "" : "s"}{" "}
            behind this
          </summary>
          <ul className="mt-2 space-y-1 text-xs text-slate-500">
            {insight.evidence.map((e) => (
              <li key={e.id}>{e.label}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}
