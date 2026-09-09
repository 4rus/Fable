import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { createTestUser } from "./helpers";
import {
  requestPasswordReset,
  resetPassword,
  InvalidResetTokenError,
} from "@/server/services/password-reset";

describe("requestPasswordReset", () => {
  it("returns a token for a known email and stores only its hash", async () => {
    const user = await createTestUser();
    const result = await requestPasswordReset(user.email);

    expect(result?.token).toBeTruthy();

    const record = await prisma.passwordResetToken.findFirst({ where: { userId: user.id } });
    expect(record).toBeTruthy();
    expect(record!.tokenHash).not.toBe(result!.token);
  });

  it("returns null for an unknown email without throwing (no account enumeration)", async () => {
    const result = await requestPasswordReset("nobody-here@example.com");
    expect(result).toBeNull();
  });

  it("is case-insensitive on email", async () => {
    // Real accounts always have a lowercased email (signUp() normalizes
    // it) — mirror that here rather than storing mixed case, then look
    // the account up using a differently-cased address.
    const user = await createTestUser("mixedcase@example.com");
    const result = await requestPasswordReset("MixedCase@Example.com");
    expect(result?.token).toBeTruthy();
    void user;
  });
});

describe("resetPassword", () => {
  it("updates the password hash and marks the token used", async () => {
    const user = await createTestUser();
    const { token } = (await requestPasswordReset(user.email))!;

    await resetPassword(token, "a-brand-new-password");

    const updated = await prisma.user.findUniqueOrThrow({ where: { id: user.id } });
    expect(await bcrypt.compare("a-brand-new-password", updated.passwordHash)).toBe(true);
    expect(updated.passwordHash).not.toBe(user.passwordHash);
  });

  it("rejects a token that has already been used", async () => {
    const user = await createTestUser();
    const { token } = (await requestPasswordReset(user.email))!;

    await resetPassword(token, "first-new-password");
    await expect(resetPassword(token, "second-new-password")).rejects.toThrow(InvalidResetTokenError);
  });

  it("rejects an unknown/garbage token", async () => {
    await expect(resetPassword("not-a-real-token", "whatever-password")).rejects.toThrow(
      InvalidResetTokenError,
    );
  });

  it("rejects an expired token", async () => {
    const user = await createTestUser();
    const { token } = (await requestPasswordReset(user.email))!;

    // Force the stored token into the past instead of waiting 30 minutes.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    await expect(resetPassword(token, "a-brand-new-password")).rejects.toThrow(InvalidResetTokenError);
  });

  it("invalidates other outstanding tokens for the same user once one succeeds", async () => {
    const user = await createTestUser();
    const first = (await requestPasswordReset(user.email))!;
    const second = (await requestPasswordReset(user.email))!;

    await resetPassword(second.token, "a-brand-new-password");

    await expect(resetPassword(first.token, "another-password")).rejects.toThrow(InvalidResetTokenError);
  });
});
