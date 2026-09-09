"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { logError } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { signupSchema } from "@/lib/validation/auth";
import { signUp, EmailInUseError } from "@/server/services/signup";

export type SignupFormState = { error?: string };

const SIGNUP_LIMIT = 5; // accounts
const SIGNUP_WINDOW_MS = 60 * 60 * 1000; // per hour, per IP

export async function signupAction(
  _prevState: SignupFormState,
  formData: FormData,
): Promise<SignupFormState> {
  const parsed = signupSchema.safeParse({
    name: formData.get("name"),
    email: formData.get("email"),
    password: formData.get("password"),
    businessName: formData.get("businessName"),
  });

  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input" };
  }

  // Unlike login, revealing "too many signups from your network, try again
  // later" doesn't create an enumeration oracle — it's fine to be explicit
  // here, and it's the only thing standing between this form and a script
  // that mass-creates accounts.
  const ip = getClientIp(await headers());
  const rate = checkRateLimit(`signup:${ip}`, SIGNUP_LIMIT, SIGNUP_WINDOW_MS);
  if (!rate.allowed) {
    return { error: "Too many accounts created from this network recently. Please try again later." };
  }

  try {
    await signUp(parsed.data);
  } catch (err) {
    if (err instanceof EmailInUseError) return { error: err.message };
    logError("signup failed", err);
    return { error: "Something went wrong creating your account. Please try again." };
  }

  redirect("/login?created=1");
}
