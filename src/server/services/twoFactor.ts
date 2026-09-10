import "server-only";
import crypto from "crypto";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { generateTotpSecret, verifyTotp, otpauthUrl } from "@/lib/totp";

const BACKUP_CODE_COUNT = 10;

function generateBackupCode(): string {
  // 5 bytes -> 10 hex chars, split for readability. Plaintext is shown to
  // the user exactly once (at generation); only its hash is ever stored.
  const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
  return `${raw.slice(0, 5)}-${raw.slice(5)}`;
}

function normalizeBackupCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function hashBackupCode(normalized: string): string {
  // Same reasoning as PasswordResetToken: these are 40 bits of CSPRNG
  // randomness, not a user-chosen low-entropy secret, so a fast hash
  // carries none of the brute-force risk it would for a password.
  return crypto.createHash("sha256").update(normalized).digest("hex");
}

export class InvalidTotpCodeError extends Error {
  constructor() {
    super("That code isn't right. Check your authenticator app and try again.");
    this.name = "InvalidTotpCodeError";
  }
}

export class InvalidPasswordError extends Error {
  constructor() {
    super("Incorrect password.");
    this.name = "InvalidPasswordError";
  }
}

export class NoPendingSetupError extends Error {
  constructor() {
    super("Start two-factor setup again before confirming a code.");
    this.name = "NoPendingSetupError";
  }
}

/**
 * Starts 2FA setup: generates a fresh secret and stores it encrypted, but
 * leaves twoFactorEnabled false. A secret existing is not the same as 2FA
 * actually protecting the account — that only happens once the user
 * proves (in confirmTwoFactorSetup) they can generate a real code from it,
 * which also rules out them mistyping/mis-scanning the secret and locking
 * themselves out.
 */
export async function generateTwoFactorSetup(userId: string, userEmail: string) {
  const secret = generateTotpSecret();
  await prisma.user.update({
    where: { id: userId },
    data: { twoFactorSecretEncrypted: encrypt(secret), twoFactorEnabled: false },
  });
  return {
    secret, // shown once for manual entry, alongside the QR code
    otpauthUrl: otpauthUrl({ secret, accountEmail: userEmail }),
  };
}

/**
 * Confirms setup: verifies a real code against the pending secret, then
 * flips twoFactorEnabled on and issues a fresh set of backup codes
 * (replacing any from an abandoned prior setup attempt). Returns the
 * backup codes in plaintext — the ONLY time they're ever available; only
 * their hashes are persisted.
 */
export async function confirmTwoFactorSetup(userId: string, code: string): Promise<{ backupCodes: string[] }> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  if (!user.twoFactorSecretEncrypted) throw new NoPendingSetupError();

  const secret = decrypt(user.twoFactorSecretEncrypted);
  if (!verifyTotp(secret, code)) throw new InvalidTotpCodeError();

  const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, generateBackupCode);

  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { twoFactorEnabled: true } }),
    prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
    prisma.twoFactorBackupCode.createMany({
      data: backupCodes.map((c) => ({ userId, codeHash: hashBackupCode(normalizeBackupCode(c)) })),
    }),
    prisma.auditLog.create({
      data: { userId, action: "auth.two_factor_enabled", entityType: "User", entityId: userId },
    }),
  ]);

  return { backupCodes };
}

/** Requires the current password — disabling 2FA is sensitive enough that
 * an already-open session shouldn't be enough on its own (e.g. a
 * momentarily unattended, logged-in browser). */
export async function disableTwoFactor(userId: string, password: string): Promise<void> {
  const user = await prisma.user.findUniqueOrThrow({ where: { id: userId } });
  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) throw new InvalidPasswordError();

  await prisma.$transaction([
    prisma.user.update({
      where: { id: userId },
      data: { twoFactorEnabled: false, twoFactorSecretEncrypted: null },
    }),
    prisma.twoFactorBackupCode.deleteMany({ where: { userId } }),
    prisma.auditLog.create({
      data: { userId, action: "auth.two_factor_disabled", entityType: "User", entityId: userId },
    }),
  ]);
}

/**
 * Verifies a code at login time — tries it as a TOTP code first, then
 * falls back to an unused backup code. Consumes (marks used) a backup
 * code the moment it succeeds, so it can never be replayed even if it
 * leaks after the fact (e.g. from a compromised paper copy someone photos
 * but hasn't used yet — using it once still burns it for everyone).
 */
export async function verifyTwoFactorCode(userId: string, rawCode: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user?.twoFactorEnabled || !user.twoFactorSecretEncrypted) return false;

  const trimmed = rawCode.trim();
  if (/^\d{6}$/.test(trimmed)) {
    const secret = decrypt(user.twoFactorSecretEncrypted);
    if (verifyTotp(secret, trimmed)) return true;
  }

  return verifyAndConsumeBackupCode(userId, trimmed);
}

async function verifyAndConsumeBackupCode(userId: string, rawCode: string): Promise<boolean> {
  const normalized = normalizeBackupCode(rawCode);
  if (normalized.length < 8) return false;

  const codeHash = hashBackupCode(normalized);
  // Scoped to userId, not just the hash — belt-and-suspenders alongside
  // the fact that codeHash is already unique per user in practice
  // (40 bits of randomness), matching the tenant-scoping convention used
  // everywhere else in this codebase.
  const record = await prisma.twoFactorBackupCode.findFirst({
    where: { userId, codeHash, usedAt: null },
  });
  if (!record) return false;

  await prisma.twoFactorBackupCode.update({ where: { id: record.id }, data: { usedAt: new Date() } });
  return true;
}

export async function countRemainingBackupCodes(userId: string): Promise<number> {
  return prisma.twoFactorBackupCode.count({ where: { userId, usedAt: null } });
}

export async function getTwoFactorStatus(userId: string) {
  const user = await prisma.user.findUniqueOrThrow({
    where: { id: userId },
    select: { twoFactorEnabled: true },
  });
  const remainingBackupCodes = user.twoFactorEnabled ? await countRemainingBackupCodes(userId) : 0;
  return { enabled: user.twoFactorEnabled, remainingBackupCodes };
}
