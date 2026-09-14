import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendWelcomeEmail } from "@/server/services/welcomeEmail";

// Same reasoning as tests/reminder-email.test.ts: force the honest
// not-configured path regardless of what's in the developer's real .env.
beforeEach(() => vi.stubEnv("RESEND_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

describe("sendWelcomeEmail", () => {
  it("reports not_configured (never a false success) when RESEND_API_KEY is unset", async () => {
    const result = await sendWelcomeEmail({ to: "new-user@example.com", name: "Jordan Lee" });
    expect(result).toEqual({ sent: false, reason: "not_configured" });
  });

  it("greets by first name only, even for a multi-word name", async () => {
    // Indirect check: spy on the underlying sendEmail to inspect the body
    // without needing a real API key.
    const emailModule = await import("@/lib/email");
    const spy = vi.spyOn(emailModule, "sendEmail");
    await sendWelcomeEmail({ to: "new-user@example.com", name: "Jordan Lee" });
    expect(spy).toHaveBeenCalledWith(
      expect.objectContaining({
        text: expect.stringContaining("Hi Jordan,"),
        html: expect.stringContaining("Hi Jordan,"),
      }),
    );
    spy.mockRestore();
  });
});
