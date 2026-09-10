import { describe, it, expect } from "vitest";
import { sendEmail } from "@/lib/email";

// RESEND_API_KEY is deliberately unset in the test environment.
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
