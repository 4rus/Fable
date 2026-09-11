import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { sendEmail } from "@/lib/email";

// Force the "not configured" path regardless of whether a real
// RESEND_API_KEY happens to be set in the developer's .env — Vitest loads
// .env per test file (after setupFiles run), so tests/setup.ts deleting
// this once isn't enough on its own; vi.stubEnv from inside the test is
// the reliable way to win that ordering.
beforeEach(() => vi.stubEnv("RESEND_API_KEY", ""));
afterEach(() => vi.unstubAllEnvs());

describe("sendEmail", () => {
  it("returns { sent: false, reason: 'not_configured' } rather than a false success when no provider is set up", async () => {
    const result = await sendEmail({
      to: "someone@example.com",
      subject: "Test",
      text: "Hello",
      html: "<p>Hello</p>",
    });
    expect(result).toEqual({ sent: false, reason: "not_configured" });
  });
});
