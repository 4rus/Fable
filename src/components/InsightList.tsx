import Link from "next/link";
import type { Insight } from "@/server/services/insights";

const severityRank: Record<Insight["severity"], number> = { critical: 0, attention: 1, info: 2 };

const kindLabel: Record<Insight["kind"], string> = {
  FACT: "From your records",
  CALCULATION: "Calculated",
  RECOMMENDATION: "Projection",
};

/**
 * Renders the full insight list with real hierarchy: the single most
 * important insight gets a "hero" treatment (this is the analytical
 * headline of the page), everything else reads as a quiet, evidence-linked
 * list — not a wall of identical cards.
 */
export default function InsightList({ insights }: { insights: Insight[] }) {
  if (insights.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line py-10 text-center">
        <p className="text-sm text-muted">
          Nothing urgent yet. Add a few invoices and expenses and this is where we&apos;ll start
          telling you what matters.
        </p>
      </div>
    );
  }

  const [hero, ...rest] = [...insights].sort(
    (a, b) => severityRank[a.severity] - severityRank[b.severity],
  );

  return (
    <div className="space-y-6">
      <HeroInsight insight={hero!} />
      {rest.length > 0 && (
        <div className="divide-y divide-line rounded-xl border border-line">
          {rest.map((insight) => (
            <InsightRow key={insight.id} insight={insight} />
          ))}
        </div>
      )}
    </div>
  );
}

const heroTone: Record<Insight["severity"], string> = {
  critical: "bg-bad-soft",
  attention: "bg-warn-soft",
  info: "bg-canvas",
};

function HeroInsight({ insight }: { insight: Insight }) {
  return (
    <div className={`rounded-xl p-6 ${heroTone[insight.severity]}`}>
      <p className="text-[11px] font-medium uppercase tracking-wide text-muted">
        {kindLabel[insight.kind]}
      </p>
      <p className="mt-1.5 text-xl font-semibold leading-snug tracking-tight text-ink">
        {insight.headline}
      </p>
      <p className="mt-2 text-sm leading-relaxed text-slate-700">{insight.explanation}</p>
      <p className="mt-2 text-sm leading-relaxed text-muted">{insight.why}</p>

      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        {insight.action && (
          <Link
            href={insight.action.href}
            className="text-sm font-medium text-accent hover:text-accent-hover"
          >
            {insight.action.label} →
          </Link>
        )}
        <span className="text-xs text-muted">{insight.basis}</span>
        {insight.evidence.length > 0 && <EvidenceDisclosure insight={insight} />}
      </div>
    </div>
  );
}

function InsightRow({ insight }: { insight: Insight }) {
  const dotTone =
    insight.severity === "critical"
      ? "bg-bad"
      : insight.severity === "attention"
        ? "bg-warn"
        : "bg-slate-300";

  return (
    <div className="flex items-start gap-3 px-5 py-4">
      <span className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${dotTone}`} />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium text-ink">{insight.headline}</p>
        <p className="mt-0.5 text-sm text-muted">{insight.explanation}</p>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          {insight.action && (
            <Link href={insight.action.href} className="text-xs font-medium text-accent">
              {insight.action.label} →
            </Link>
          )}
          <span className="text-xs text-slate-400">{insight.basis}</span>
          {insight.evidence.length > 0 && <EvidenceDisclosure insight={insight} compact />}
        </div>
      </div>
    </div>
  );
}

function EvidenceDisclosure({ insight, compact }: { insight: Insight; compact?: boolean }) {
  return (
    <details className="group">
      <summary
        className={`cursor-pointer font-medium text-accent marker:content-none ${compact ? "text-xs" : "text-sm"}`}
      >
        {insight.evidence.length} record{insight.evidence.length === 1 ? "" : "s"} · view
      </summary>
      <ul className="mt-2 space-y-1 text-xs text-muted">
        {insight.evidence.map((e) => (
          <li key={e.id}>{e.label}</li>
        ))}
      </ul>
    </details>
  );
}
