import Link from "next/link";
import { getActiveBusinessContext } from "@/server/services/businesses";
import { getCurrentCashCents, computeForecast } from "@/server/services/forecast";
import { getAllInsights, summarizeInsights } from "@/server/services/insights";
import { formatCentsCompact } from "@/lib/money";
import ThingsToDo from "@/components/ThingsToDo";

function dateline(): string {
  return new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export default async function DashboardPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const [cashCents, f30, f90, insights] = await Promise.all([
    getCurrentCashCents(business.id),
    computeForecast(business.id, 30),
    computeForecast(business.id, 90),
    getAllInsights(business.id),
  ]);

  const { headline, spotlight, rest } = summarizeInsights(insights);
  // Only feature the spotlight as a contrastive "But..." sentence when it's
  // actually a concern — an "info"-severity spotlight (nothing urgent, just
  // the least-unimportant fact) doesn't deserve a dramatic "but".
  const contrast = spotlight && spotlight.severity !== "info" ? spotlight : null;
  const thingsToDo = contrast ? rest : insights;

  const trajectory = [
    { label: "Today", cents: cashCents, date: null as string | null },
    { label: "30 days", cents: f30.projectedCashCents, date: f30.targetDate },
    { label: "90 days", cents: f90.projectedCashCents, date: f90.targetDate },
  ];

  return (
    <div className="max-w-2xl space-y-14">
      <div>
        <p className="text-xs text-muted">{business.name} · {dateline()}</p>

        <p className="mt-5 font-serif text-[26px] leading-snug tracking-tight text-ink sm:text-[30px]">
          {headline}
        </p>

        <p className="mt-2 font-serif text-[15px] tabular-nums leading-none text-muted">
          <span className="text-[56px] font-medium leading-none tracking-tight text-ink sm:text-[64px]">
            {formatCentsCompact(cashCents)}
          </span>{" "}
          available today
        </p>

        {contrast && (
          <p className="mt-5 max-w-lg text-[17px] leading-relaxed text-ink">
            But{" "}
            <Link href={contrast.action?.href ?? "#"} className="underline decoration-line underline-offset-4 hover:decoration-ink">
              {decapitalize(contrast.headline)}
            </Link>
            . {contrast.why}
          </p>
        )}
      </div>

      <div>
        <p className="text-xs font-medium uppercase tracking-wide text-muted">Here&apos;s what changed</p>
        <div className="mt-4 flex items-end justify-between border-b border-line pb-4">
          {trajectory.map((t) => (
            <div key={t.label}>
              <p className="text-xs text-muted">{t.label}</p>
              <p
                className={`mt-1 font-serif text-2xl tracking-tight tabular-nums ${t.cents < 0 ? "text-bad" : "text-ink"}`}
              >
                {formatCentsCompact(t.cents)}
              </p>
            </div>
          ))}
        </div>
        <Link href="/app/forecast" className="mt-3 inline-block text-xs font-medium text-accent">
          Full forecast →
        </Link>
      </div>

      <div>
        <p className="font-serif text-xl tracking-tight text-ink">
          {thingsToDo.length === 0
            ? "Nothing else needs your attention today"
            : `${thingsToDo.length} thing${thingsToDo.length === 1 ? "" : "s"} worth doing today`}
        </p>
        <div className="mt-5">
          <ThingsToDo insights={thingsToDo} businessId={business.id} />
        </div>
      </div>
    </div>
  );
}

function decapitalize(s: string): string {
  // Only lowercases when the string opens with a letter (most of our
  // headlines open with a dollar amount or "You" — leave those alone).
  if (/^[A-Z][a-z]/.test(s) && !s.startsWith("You")) {
    return s.charAt(0).toLowerCase() + s.slice(1);
  }
  return s;
}
