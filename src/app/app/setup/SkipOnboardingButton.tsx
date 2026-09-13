"use client";

import { useTransition } from "react";
import { skipOnboardingAction } from "@/server/actions/onboarding";

export default function SkipOnboardingButton({ businessId }: { businessId: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => skipOnboardingAction(businessId))}
      disabled={pending}
      className="text-xs font-medium text-muted underline decoration-line underline-offset-4 hover:text-ink"
    >
      {pending ? "One moment…" : "I'll do this manually"}
    </button>
  );
}
