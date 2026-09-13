import Link from "next/link";
import type { OnboardingStep } from "@/server/services/onboarding";

/**
 * The persistent safety net for whoever skipped (or hasn't finished) the
 * guided `/app/setup` screen — same typographic-list pattern as
 * ThingsToDo, shown in its place whenever there are no real insights yet
 * to fill that slot. Disappears the moment real insights exist (see
 * app/page.tsx), and each item disappears the moment its own step is done.
 */
export default function OnboardingChecklist({ steps }: { steps: OnboardingStep[] }) {
  if (steps.length === 0) return null;

  return (
    <ol className="space-y-4">
      {steps.map((step, i) => (
        <li key={step.id} className="flex items-center gap-3">
          <span className="font-serif text-lg leading-6 text-muted">{String(i + 1).padStart(2, "0")}</span>
          <Link href={step.href} className="text-[15px] font-medium text-accent">
            {step.label} →
          </Link>
        </li>
      ))}
    </ol>
  );
}
