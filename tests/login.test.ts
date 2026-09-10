import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { prisma } from "@/lib/db";
import { verifyCredentials } from "@/server/services/login";
import { generateTwoFactorSetup, confirmTwoFactorSetup } from "@/server/services/twoFactor";
import { generateTotp } from "@/lib/totp";

async function createTestUserWithPassword(password: string) {
  const passwordHash = await bcrypt.hash(password, 4); // low cost factor -- fast tests
  return prisma.user.create({
    data: {
      name: "Test User",
      email: `login-${Date.now()}-${Math.random()}@example.com`,
      passwordHash,
    },
  });
}

describe("verifyCredentials", () => {
  it("returns the user (with twoFactorEnabled: false) for correct credentials", async () => {
    const user = await createTestUserWithPassword("a-correct-password");
    const result = await verifyCredentials(user.email, "a-correct-password", "127.0.0.1");
    expect(result?.id).toBe(user.id);
    expect(result?.twoFactorEnabled).toBe(false);
  });

  it("returns twoFactorEnabled: true for an account with 2FA on -- caller decides what to do with that", async () => {
    const user = await createTestUserWithPassword("a-correct-password");
    const { secret } = await generateTwoFactorSetup(user.id, user.email);
    await confirmTwoFactorSetup(user.id, generateTotp(secret));

    const result = await verifyCredentials(user.email, "a-correct-password", "127.0.0.2");
    expect(result?.twoFactorEnabled).toBe(true);
    // Crucially: the password alone is enough for THIS function to
    // succeed -- it is authorize()'s job (src/lib/auth.ts) to additionally
    // require and verify a totpCode before minting a session. This
    // function only answers "is the password right?"
  });

  it("returns null for a wrong password", async () => {
    const user = await createTestUserWithPassword("a-correct-password");
    expect(await verifyCredentials(user.email, "wrong-password", "127.0.0.3")).toBeNull();
  });

  it("returns null for an unknown email without throwing", async () => {
    expect(await verifyCredentials("nobody@example.com", "whatever", "127.0.0.4")).toBeNull();
  });

  it("is case-insensitive on email", async () => {
    const user = await createTestUserWithPassword("a-correct-password");
    // verifyCredentials lowercases internally; the DB record itself is
    // already lowercase (as signUp() normalizes), so exercise the
    // case-insensitivity via the lookup argument, not the stored value.
    const result = await verifyCredentials(user.email.toUpperCase(), "a-correct-password", "127.0.0.5");
    expect(result?.id).toBe(user.id);
  });

  it("rate-limits repeated attempts for the same ip+email", async () => {
    const user = await createTestUserWithPassword("a-correct-password");
    const ip = `127.0.0.${Math.floor(Math.random() * 200) + 10}`; // fresh bucket per test run

    for (let i = 0; i < 10; i++) {
      await verifyCredentials(user.email, "wrong-password", ip);
    }
    // 11th attempt, even with the CORRECT password, must be blocked --
    // proves the limiter fires on the password itself, not just on
    // failures, once the budget is exhausted.
    expect(await verifyCredentials(user.email, "a-correct-password", ip)).toBeNull();
  });
});
