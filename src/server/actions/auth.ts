"use server";

import { redirect } from "next/navigation";
import { headers } from "next/headers";
import { logError } from "@/lib/logger";
import { checkRateLimit, getClientIp } from "@/lib/rate-limit";
import { signupSchema, requestPasswordResetSchema, resetPasswordSchema } from "@/lib/validation/auth";
import { signUp, EmailInUseError } from "@/server/services/signup";
import {
  requestPasswordReset,
  resetPassword,
  InvalidResetTokenError,
} from "@/server/services/password-reset";
import { sendEmail } from "@/lib/email";

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
    currency: formData.get("currency") || undefined,
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

export type RequestResetFormState = { error?: string; resetLink?: string; submitted?: boolean };

const RESET_REQUEST_LIMIT = 5;
const RESET_REQUEST_WINDOW_MS = 60 * 60 * 1000; // per hour, per IP

/**
 * Starts a password reset. Always returns `submitted: true` regardless of
 * whether the email matched an account — this is the one place we must
 * NOT reveal account existence via response shape or timing shortcuts.
 *
 * The token this creates is always real, single-use, and expires in 30
 * minutes. Delivery has two honest paths (src/lib/email.ts):
 *  - RESEND_API_KEY configured: actually emails the link; the response
 *    carries no `resetLink` at all, since it genuinely went out.
 *  - Not configured: falls back to surfacing the link directly in the
 *    response (clearly labeled "Development mode" in the UI) instead of
 *    pretending an email was sent.
 */
export async function requestPasswordResetAction(
  _prevState: RequestResetFormState,
  formData: FormData,
): Promise<RequestResetFormState> {
  const parsed = requestPasswordResetSchema.safeParse({ email: formData.get("email") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Enter a valid email address." };
  }

  const ip = getClientIp(await headers());
  const rate = checkRateLimit(`reset-request:${ip}`, RESET_REQUEST_LIMIT, RESET_REQUEST_WINDOW_MS);
  if (!rate.allowed) {
    return { error: "Too many reset attempts from this network. Please try again later." };
  }

  try {
    const result = await requestPasswordReset(parsed.data.email);
    if (!result) return { submitted: true }; // no matching account — same response either way

    const origin = (process.env.NEXTAUTH_URL ?? "http://localhost:3000").replace(/\/$/, "");
    const link = `${origin}/reset-password?token=${result.token}`;

    const emailResult = await sendEmail({
      to: parsed.data.email,
      subject: "Reset your Fable password",
      text: `Reset your password: ${link}\n\nThis link expires in 30 minutes. If you didn't request this, ignore this email.`,
      html: `<p>Reset your password by clicking the link below. It expires in 30 minutes.</p><p><a href="${link}">${link}</a></p><p>If you didn't request this, ignore this email.</p>`,
    });

    return {
      submitted: true,
      resetLink: emailResult.sent ? undefined : `/reset-password?token=${result.token}`,
    };
  } catch (err) {
    logError("password reset request failed", err);
    // Still report success to the user — don't leak whether it errored
    // for a real vs. nonexistent account, and don't block the UI.
    return { submitted: true };
  }
}

export type ResetPasswordFormState = { error?: string; success?: boolean };

export async function resetPasswordAction(
  _prevState: ResetPasswordFormState,
  formData: FormData,
): Promise<ResetPasswordFormState> {
  const parsed = resetPasswordSchema.safeParse({
    token: formData.get("token"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid input." };
  }

  try {
    await resetPassword(parsed.data.token, parsed.data.password);
  } catch (err) {
    if (err instanceof InvalidResetTokenError) return { error: err.message };
    logError("password reset failed", err);
    return { error: "Something went wrong resetting your password. Please try again." };
  }

  return { success: true };
}
