import { redirect } from "next/navigation";
import { getActiveBusinessContext } from "@/server/services/businesses";
import { getOnboardingStatus } from "@/server/services/onboarding";
import ConnectBankButton from "@/app/app/bank/ConnectBankButton";
import SkipOnboardingButton from "./SkipOnboardingButton";

/**
 * The one-time guided setup screen — shown instead of the real Overview
 * page the first time a business has no real data and hasn't skipped
 * (see getOnboardingStatus.isComplete). Deliberately one focused screen,
 * not a multi-step wizard: the single highest-value action (connecting a
 * bank, since that's the fastest path to Fable actually being useful — no
 * manual entry needed once transactions are flowing) front and center,
 * with an honest, un-hidden way out for anyone who'd rather enter things
 * by hand. Once left (either path), this never appears again — the
 * Overview page's own checklist picks up whatever's still outstanding.
 */
export default async function SetupPage() {
  const { business: maybeBusiness } = await getActiveBusinessContext();
  const business = maybeBusiness!;

  const status = await getOnboardingStatus(business.id);
  if (status.isComplete) redirect("/app");

  return (
    <div className="mx-auto max-w-md py-16 text-center">
      <p className="text-xs text-muted">{business.name}</p>
      <h1 className="mt-3 font-serif text-[28px] leading-snug tracking-tight text-ink">
        Let&apos;s get Fable working for you.
      </h1>
      <p className="mt-3 text-sm leading-relaxed text-muted">
        Connect a bank account and Fable starts reading your real transactions automatically —
        that&apos;s the fastest way to see a real insight, with no manual entry.
      </p>

      <div className="mt-8 flex flex-col items-center gap-4">
        <ConnectBankButton businessId={business.id} />
        <SkipOnboardingButton businessId={business.id} />
      </div>
    </div>
  );
}
