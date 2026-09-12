import Link from "next/link";
import type { Insight } from "@/server/services/insights";
import InsightQuickActionButton from "./InsightQuickActionButton";

const markTone: Record<Insight["severity"], string> = {
  critical: "text-bad",
  attention: "text-warn",
  info: "text-muted",
};

/**
 * Plain typographic list — no card, no border, no pill. Severity is a
 * colored glyph in front of the text, not a background tint on a
 * container. This is meant to read as a short list a person wrote, not a
 * grid of alert widgets.
 */
export default function ThingsToDo({ insights, businessId }: { insights: Insight[]; businessId: string }) {
  if (insights.length === 0) return null;

  return (
    <ol className="space-y-5">
      {insights.map((insight, i) => (
        <li key={insight.id} className="flex gap-3">
          <span className={`font-serif text-lg leading-6 ${markTone[insight.severity]}`}>
            {String(i + 1).padStart(2, "0")}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-[15px] text-ink">{insight.headline}</p>
            <p className="mt-0.5 text-sm text-muted">{insight.explanation}</p>
            <div className="mt-1 flex flex-wrap items-center gap-x-3 text-xs">
              {insight.action && (
                <Link href={insight.action.href} className="font-medium text-accent">
                  {insight.action.label} →
                </Link>
              )}
              <span className="text-muted">{insight.basis}</span>
            </div>
            {insight.quickAction && (
              <div className="mt-2">
                <InsightQuickActionButton businessId={businessId} quickAction={insight.quickAction} />
              </div>
            )}
          </div>
        </li>
      ))}
    </ol>
  );
}
