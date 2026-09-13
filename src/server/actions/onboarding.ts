"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireMembership, requireOwner } from "@/server/tenant";
import { skipOnboarding, confirmStartingCash } from "@/server/services/onboarding";
import { dollarsToCents } from "@/lib/money";
import { startingCashSchema } from "@/lib/validation/onboarding";
import { logError } from "@/lib/logger";

export type ActionState = { error?: string };

/** Exits the one-time guided setup screen without doing anything —
 * `requireMembership` (not `requireOwner`) since this is harmless UX
 * state, not a financial mutation. See onboarding.ts's `isComplete`. */
export async function skipOnboardingAction(businessId: string) {
  await requireMembership(businessId);
  await skipOnboarding(businessId);
  redirect("/app");
}

/**
 * Sets the business's starting cash balance — the one number every
 * forecast/cash-position calculation in the app builds on
 * (src/server/services/forecast.ts's getCurrentCashCents). Owner-only:
 * unlike skipping onboarding, this changes a real number every team
 * member's forecast depends on.
 */
export async function confirmStartingCashAction(
  businessId: string,
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  await requireOwner(businessId);

  const parsed = startingCashSchema.safeParse({
    amount: formData.get("amount"),
    asOfDate: formData.get("asOfDate"),
  });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const asOfDate = new Date(parsed.data.asOfDate);
  if (Number.isNaN(asOfDate.getTime())) return { error: "Enter a valid date" };

  let cents: number;
  try {
    cents = dollarsToCents(parsed.data.amount);
  } catch {
    return { error: "Enter a valid dollar amount" };
  }

  try {
    await confirmStartingCash(businessId, cents, asOfDate);
  } catch (err) {
    logError("confirmStartingCash failed", err, { businessId });
    return { error: "Could not save. Please try again." };
  }

  revalidatePath("/app");
  revalidatePath("/app/forecast");
  revalidatePath("/app/settings/business");
  return {};
}
