"use server";

import { headers } from "next/headers";
import { revalidatePath } from "next/cache";
import QRCode from "qrcode";
import { requireUser } from "@/server/tenant";
import { getClientIp } from "@/lib/rate-limit";
import { logError } from "@/lib/logger";
import { verifyCredentials } from "@/server/services/login";
import {
  generateTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  InvalidTotpCodeError,
  InvalidPasswordError,
  NoPendingSetupError,
} from "@/server/services/twoFactor";
import {
  checkCredentialsSchema,
  confirmTwoFactorSchema,
  disableTwoFactorSchema,
} from "@/lib/validation/twoFactor";

/**
 * Pre-signIn check the login form calls BEFORE attempting a real
 * NextAuth signIn(): verifies the password (through the exact same
 * verifyCredentials() — and therefore the exact same rate-limit bucket —
 * that authorize() itself uses) and reports whether the account has 2FA
 * enabled, so the form knows whether to show a code field. This never
 * creates a session; the actual signIn() call still happens afterward
 * and still re-verifies everything server-side. Skipping straight to
 * signIn() with a guessed totpCode gains an attacker nothing — they still
 * need the real password AND the real code in that one authorize() call.
 */
export type CheckCredentialsState = { ok: boolean; requiresTwoFactor: boolean; error?: string };

export async function checkCredentialsAction(email: string, password: string): Promise<CheckCredentialsState> {
  const parsed = checkCredentialsSchema.safeParse({ email, password });
  if (!parsed.success) {
    return { ok: false, requiresTwoFactor: false, error: "Enter your email and password." };
  }

  const ip = getClientIp(await headers());
  const user = await verifyCredentials(parsed.data.email, parsed.data.password, ip);
  if (!user) {
    return { ok: false, requiresTwoFactor: false, error: "Incorrect email or password." };
  }

  return { ok: true, requiresTwoFactor: user.twoFactorEnabled };
}

export type SetupTwoFactorState = { qrCodeDataUrl: string; secret: string } | { error: string };

export async function setupTwoFactorAction(): Promise<SetupTwoFactorState> {
  const { userId, userEmail } = await requireUser();
  try {
    const { secret, otpauthUrl } = await generateTwoFactorSetup(userId, userEmail);
    const qrCodeDataUrl = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 240 });
    return { qrCodeDataUrl, secret };
  } catch (err) {
    logError("2FA setup failed", err);
    return { error: "Could not start two-factor setup. Please try again." };
  }
}

export type ConfirmTwoFactorState = { error?: string; backupCodes?: string[] };

export async function confirmTwoFactorAction(
  _prevState: ConfirmTwoFactorState,
  formData: FormData,
): Promise<ConfirmTwoFactorState> {
  const parsed = confirmTwoFactorSchema.safeParse({ code: formData.get("code") });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Invalid code" };
  }

  const { userId } = await requireUser();

  try {
    const { backupCodes } = await confirmTwoFactorSetup(userId, parsed.data.code);
    revalidatePath("/app/settings/security");
    return { backupCodes };
  } catch (err) {
    if (err instanceof InvalidTotpCodeError || err instanceof NoPendingSetupError) {
      return { error: err.message };
    }
    logError("2FA confirm failed", err);
    return { error: "Could not confirm two-factor setup. Please try again." };
  }
}

export type DisableTwoFactorState = { error?: string };

export async function disableTwoFactorAction(
  _prevState: DisableTwoFactorState,
  formData: FormData,
): Promise<DisableTwoFactorState> {
  const parsed = disableTwoFactorSchema.safeParse({ password: formData.get("password") });
  if (!parsed.success) {
    return { error: "Enter your password." };
  }

  const { userId } = await requireUser();

  try {
    await disableTwoFactor(userId, parsed.data.password);
  } catch (err) {
    if (err instanceof InvalidPasswordError) return { error: err.message };
    logError("2FA disable failed", err);
    return { error: "Could not disable two-factor authentication. Please try again." };
  }

  revalidatePath("/app/settings/security");
  return {};
}
