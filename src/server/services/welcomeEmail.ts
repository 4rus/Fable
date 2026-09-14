import "server-only";
import { sendEmail, type SendEmailResult } from "@/lib/email";

/**
 * WELCOME EMAIL (feature request, 2026-09). Sent once, right after a
 * signup completes — same real src/lib/email.ts path as every other email
 * in the app (never a fake "sent" confirmation; see email.ts's own
 * doc-comment for the two honest outcomes).
 *
 * Deliberately fire-and-forget from the caller's point of view: a failure
 * or missing RESEND_API_KEY here must never fail signup itself — the
 * account is already created by the time this runs. Callers should log
 * but not surface `result.sent === false` to the user as an error.
 */
export async function sendWelcomeEmail(params: { to: string; name: string }): Promise<SendEmailResult> {
  const firstName = params.name.trim().split(/\s+/)[0] || params.name;

  return sendEmail({
    to: params.to,
    subject: "Welcome to Fable",
    text: `Hi ${firstName},\n\nYour Fable account is set up. Fable turns your invoices, expenses, and bank activity into plain-language answers about where your business stands — what changed, why, and what to do next.\n\nA couple of good next steps:\n- Connect a bank account for automatic transaction tracking\n- Send your first invoice\n- Log a starting cash balance so your forecasts are accurate from day one\n\nIf anything looks off or you have questions, just reply to this email.\n\n— The Fable team`,
    html: `
      <p>Hi ${escapeHtml(firstName)},</p>
      <p>Your Fable account is set up. Fable turns your invoices, expenses, and bank activity into plain-language answers about where your business stands — what changed, why, and what to do next.</p>
      <p>A couple of good next steps:</p>
      <ul>
        <li>Connect a bank account for automatic transaction tracking</li>
        <li>Send your first invoice</li>
        <li>Log a starting cash balance so your forecasts are accurate from day one</li>
      </ul>
      <p>If anything looks off or you have questions, just reply to this email.</p>
      <p>— The Fable team</p>
    `.trim(),
  });
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
