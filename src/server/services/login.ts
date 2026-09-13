import "server-only";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { logWarn } from "@/lib/logger";

const LOGIN_LIMIT = 10; // attempts
const LOGIN_WINDOW_MS = 10 * 60 * 1000; // per 10 minutes

// A real bcrypt hash of a random value, used only to equalize timing when
// no matching user is found. Never a real credential.
const DUMMY_HASH = "$2a$10$CwTycUXWue0Thq9StjUM0uJ8lqfyd1rG4XX9EbeM.0DFhrN3VYW7C";

export interface VerifiedCredentialsUser {
  id: string;
  email: string;
  name: string;
  twoFactorEnabled: boolean;
}

/**
 * The one place password credentials get checked — used by BOTH the
 * NextAuth authorize() callback (src/lib/auth.ts) and the pre-signIn
 * checkCredentialsAction (src/server/actions/twoFactor.ts) that the login
 * form calls first to find out whether it needs to show a 2FA code field.
 * Sharing this function means both call sites share the exact same
 * rate-limit bucket (keyed on ip+email) — calling the pre-check
 * repeatedly can't be used to dodge the brute-force limit NextAuth's own
 * authorize() enforces, because it's the same limiter, same key.
 *
 * Deliberately returns a plain `null` on ANY failure — wrong password,
 * unknown email, or rate-limited — never a reason code, so a caller can't
 * accidentally build a user-enumeration oracle on top of this.
 */
export async function verifyCredentials(
  email: string,
  password: string,
  ip: string,
): Promise<VerifiedCredentialsUser | null> {
  const normalizedEmail = email.toLowerCase();
  const rate = await checkRateLimit(`login:${ip}:${normalizedEmail}`, LOGIN_LIMIT, LOGIN_WINDOW_MS);
  if (!rate.allowed) {
    logWarn("login rate limit exceeded", { ip, email: normalizedEmail });
    return null;
  }

  const user = await prisma.user.findUnique({ where: { email: normalizedEmail } });
  // Deliberately compare against a dummy hash even when no user exists, so
  // response timing doesn't leak which emails are registered.
  const hashToCompare = user?.passwordHash ?? DUMMY_HASH;
  const valid = await bcrypt.compare(password, hashToCompare);
  if (!user || !valid) return null;

  return { id: user.id, email: user.email, name: user.name, twoFactorEnabled: user.twoFactorEnabled };
}
