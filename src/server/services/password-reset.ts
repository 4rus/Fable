import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";

const TOKEN_BYTES = 32;
const TOKEN_TTL_MS = 30 * 60 * 1000; // 30 minutes

function hashToken(token: string): string {
  // Not a secret in the same sense as a password (it's short-lived and
  // single-use), but we still never store it in plaintext — a DB read
  // (backup, replica, accidental log) should not be enough to reset an
  // account. SHA-256 is fine here: the token itself is 256 bits of CSPRNG
  // randomness, not a low-entropy user-chosen value, so there's no
  // brute-force concern the way there is with a password hash.
  return crypto.createHash("sha256").update(token).digest("hex");
}

/**
 * Starts a password reset. Always looks like it succeeded from the
 * caller's point of view (see the action layer) — this function itself
 * returns null for an unknown email so the action can decide how to
 * respond without ever telling an enumeration attacker whether an
 * account exists.
 *
 * Returns the raw (unhashed) token so the caller can build a reset link.
 * In production this would be emailed, never rendered — see the comment
 * on the action layer for why it's surfaced directly right now.
 */
export async function requestPasswordReset(email: string): Promise<{ token: string } | null> {
  const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) return null;

  const token = crypto.randomBytes(TOKEN_BYTES).toString("base64url");
  await prisma.passwordResetToken.create({
    data: {
      userId: user.id,
      tokenHash: hashToken(token),
      expiresAt: new Date(Date.now() + TOKEN_TTL_MS),
    },
  });

  return { token };
}

export class InvalidResetTokenError extends Error {
  constructor() {
    super("This reset link is invalid or has expired.");
    this.name = "InvalidResetTokenError";
  }
}

/**
 * Validates a token and, if valid, updates the password and marks the
 * token used. Also invalidates every other outstanding token for the
 * same user — a stale, previously-issued link shouldn't remain usable
 * after a successful reset.
 */
export async function resetPassword(token: string, newPassword: string): Promise<void> {
  const tokenHash = hashToken(token);
  const record = await prisma.passwordResetToken.findUnique({ where: { tokenHash } });

  if (!record || record.usedAt || record.expiresAt < new Date()) {
    throw new InvalidResetTokenError();
  }

  const passwordHash = await bcrypt.hash(newPassword, 12);

  await prisma.$transaction([
    prisma.user.update({ where: { id: record.userId }, data: { passwordHash } }),
    prisma.passwordResetToken.update({ where: { id: record.id }, data: { usedAt: new Date() } }),
    // Invalidate any other unused tokens for this user.
    prisma.passwordResetToken.updateMany({
      where: { userId: record.userId, usedAt: null, id: { not: record.id } },
      data: { usedAt: new Date() },
    }),
  ]);
}
