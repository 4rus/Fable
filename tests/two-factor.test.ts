import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createTestUser } from "./helpers";
import { generateTotp } from "@/lib/totp";
import { decrypt } from "@/lib/crypto";
import {
  generateTwoFactorSetup,
  confirmTwoFactorSetup,
  disableTwoFactor,
  verifyTwoFactorCode,
  countRemainingBackupCodes,
  getTwoFactorStatus,
  InvalidTotpCodeError,
  InvalidPasswordError,
  NoPendingSetupError,
} from "@/server/services/twoFactor";

async function createTestUserWithPassword(password: string, email?: string) {
  const passwordHash = await bcrypt.hash(password, 4); // low cost factor -- fast tests, not production hashing
  return prisma.user.create({
    data: { name: "Test User", email: email ?? `2fa-${Date.now()}-${Math.random()}@example.com`, passwordHash },
  });
}

describe("generateTwoFactorSetup", () => {
  it("stores an encrypted secret without enabling 2FA yet", async () => {
    const user = await createTestUser();
    const { secret, otpauthUrl } = await generateTwoFactorSetup(user.id, user.email);

    expect(secret).toMatch(/^[A-Z2-7]+$/);
    expect(otpauthUrl).toContain(`secret=${secret}`);

    const status = await getTwoFactorStatus(user.id);
    expect(status.enabled).toBe(false);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorSecretEncrypted).toBeTruthy();
    // The stored value must actually be encrypted, not the raw secret.
    expect(stored.twoFactorSecretEncrypted).not.toBe(secret);
    expect(decrypt(stored.twoFactorSecretEncrypted!)).toBe(secret);
  });
});

describe("confirmTwoFactorSetup", () => {
  it("enables 2FA and returns 10 backup codes when given a real code", async () => {
    const user = await createTestUser();
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    const code = generateTotp(secret);

    const { backupCodes } = await confirmTwoFactorSetup(user.id, code);

    expect(backupCodes).toHaveLength(10);
    expect(new Set(backupCodes).size).toBe(10); // all unique

    const status = await getTwoFactorStatus(user.id);
    expect(status.enabled).toBe(true);
    expect(status.remainingBackupCodes).toBe(10);
  });

  it("rejects a wrong code and leaves 2FA disabled", async () => {
    const user = await createTestUser();
    await generateTwoFactorSetup(user.id, user.email);

    await expect(confirmTwoFactorSetup(user.id, "000000")).rejects.toThrow(InvalidTotpCodeError);
    expect((await getTwoFactorStatus(user.id)).enabled).toBe(false);
  });

  it("rejects confirming with no setup in progress", async () => {
    const user = await createTestUser();
    await expect(confirmTwoFactorSetup(user.id, "123456")).rejects.toThrow(NoPendingSetupError);
  });

  it("writes an audit log entry when 2FA is enabled", async () => {
    const user = await createTestUser();
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));

    const entry = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "auth.two_factor_enabled" },
    });
    expect(entry).toBeTruthy();
  });
});

describe("verifyTwoFactorCode", () => {
  it("accepts a valid TOTP code", async () => {
    const user = await createTestUser();
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));

    expect(await verifyTwoFactorCode(user.id, generateTotp(secret))).toBe(true);
  });

  it("rejects a wrong TOTP code", async () => {
    const user = await createTestUser();
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));

    expect(await verifyTwoFactorCode(user.id, "000000")).toBe(false);
  });

  it("returns false for a user who never enabled 2FA", async () => {
    const user = await createTestUser();
    expect(await verifyTwoFactorCode(user.id, "123456")).toBe(false);
  });

  it("accepts a backup code exactly once, then rejects it on reuse", async () => {
    const user = await createTestUser();
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    const { backupCodes } = await confirmTwoFactorSetup(user.id, generateTotp(secret));
    const code = backupCodes[0]!;

    expect(await verifyTwoFactorCode(user.id, code)).toBe(true);
    expect(await verifyTwoFactorCode(user.id, code)).toBe(false); // burned

    expect(await countRemainingBackupCodes(user.id)).toBe(9);
  });

  it("accepts a backup code typed without its dash", async () => {
    const user = await createTestUser();
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    const { backupCodes } = await confirmTwoFactorSetup(user.id, generateTotp(secret));
    const withoutDash = backupCodes[0]!.replace("-", "");

    expect(await verifyTwoFactorCode(user.id, withoutDash)).toBe(true);
  });

  it("rejects a backup code belonging to a different user", async () => {
    const userA = await createTestUser();
    const userB = await createTestUser();
    const setupA = await generateTwoFactorSetup(userA.id, userA.email);
    await confirmTwoFactorSetup(userA.id, generateTotp(setupA.secret));

    const setupB = await generateTwoFactorSetup(userB.id, userB.email);
    const { backupCodes: codesB } = await confirmTwoFactorSetup(userB.id, generateTotp(setupB.secret));

    // userA's code pool must never accept userB's real backup code.
    expect(await verifyTwoFactorCode(userA.id, codesB[0]!)).toBe(false);
  });
});

describe("disableTwoFactor", () => {
  it("requires the correct password", async () => {
    const user = await createTestUserWithPassword("correct-password-123");
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));

    await expect(disableTwoFactor(user.id, "wrong-password")).rejects.toThrow(InvalidPasswordError);
    expect((await getTwoFactorStatus(user.id)).enabled).toBe(true); // unchanged
  });

  it("clears the secret and all backup codes on success", async () => {
    const user = await createTestUserWithPassword("correct-password-123");
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));

    await disableTwoFactor(user.id, "correct-password-123");

    const status = await getTwoFactorStatus(user.id);
    expect(status.enabled).toBe(false);
    expect(status.remainingBackupCodes).toBe(0);

    const stored = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(stored.twoFactorSecretEncrypted).toBeNull();

    // A previously-valid TOTP code must not work anymore.
    expect(await verifyTwoFactorCode(user.id, generateTotp(secret))).toBe(false);
  });

  it("writes an audit log entry when 2FA is disabled", async () => {
    const user = await createTestUserWithPassword("correct-password-123");
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));
    await disableTwoFactor(user.id, "correct-password-123");

    const entry = await prisma.auditLog.findFirst({
      where: { userId: user.id, action: "auth.two_factor_disabled" },
    });
    expect(entry).toBeTruthy();
  });
});
