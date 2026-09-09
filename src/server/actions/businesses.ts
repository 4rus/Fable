"use server";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireUser, requireMembership } from "@/server/tenant";
import { createBusinessForUser } from "@/server/services/businesses";
import { createBusinessSchema } from "@/lib/validation/businesses";
import { logError } from "@/lib/logger";
import { ACTIVE_BUSINESS_COOKIE } from "@/lib/constants";

export type ActionState = { error?: string };

export async function switchBusinessAction(businessId: string) {
  // requireMembership rejects outright if the caller isn't actually a
  // member of this business — you can't "switch" to a workspace you're
  // not on by forging this call.
  await requireMembership(businessId);

  const store = await cookies();
  store.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  revalidatePath("/app", "layout");
}

export async function createBusinessAction(
  _prevState: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const parsed = createBusinessSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Invalid input" };

  const { userId } = await requireUser();

  let businessId: string;
  try {
    const business = await createBusinessForUser(userId, parsed.data.name);
    businessId = business.id;
  } catch (err) {
    logError("createBusiness failed", err);
    return { error: "Could not create the workspace. Please try again." };
  }

  const store = await cookies();
  store.set(ACTIVE_BUSINESS_COOKIE, businessId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });

  redirect("/app");
}
