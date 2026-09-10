import "server-only";
import { Resend } from "resend";
import { logError, logInfo } from "@/lib/logger";

/**
 * The one place outbound email goes through. Two states, both real (never
 * fake success):
 *
 *  - RESEND_API_KEY configured: actually sends via Resend, returns
 *    { sent: true }.
 *  - Not configured (the default in this environment — see README): does
 *    NOT send, does NOT pretend to have sent, and returns
 *    { sent: false, reason: "not_configured" } so the caller can fall back
 *    to something honest (e.g. password-reset's "here's the link directly,
 *    since we can't email it yet" dev-mode notice, or a clear error for
 *    invoice sending rather than a false "Sent!" confirmation).
 *
 * Callers must never assume { sent: false } means failure vs. "email
 * just isn't wired up here" — the `reason` field distinguishes them.
 */

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: { filename: string; content: Buffer }[];
}

export type SendEmailResult =
  | { sent: true }
  | { sent: false; reason: "not_configured" }
  | { sent: false; reason: "send_failed"; message: string };

function getFromAddress(): string {
  // A verified sender identity is required by every transactional email
  // provider (Resend included) — this is not optional configuration.
  return process.env.EMAIL_FROM || "Fable <onboarding@resend.dev>";
}

export async function sendEmail(params: SendEmailParams): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    logInfo("email not sent: RESEND_API_KEY not configured", { to: redactEmail(params.to) });
    return { sent: false, reason: "not_configured" };
  }

  const resend = new Resend(apiKey);
  try {
    const result = await resend.emails.send({
      from: getFromAddress(),
      to: params.to,
      subject: params.subject,
      html: params.html,
      text: params.text,
      attachments: params.attachments?.map((a) => ({ filename: a.filename, content: a.content })),
    });
    if (result.error) {
      logError("email send failed", new Error(result.error.message), { to: redactEmail(params.to) });
      return { sent: false, reason: "send_failed", message: result.error.message };
    }
    return { sent: true };
  } catch (err) {
    logError("email send threw", err, { to: redactEmail(params.to) });
    return { sent: false, reason: "send_failed", message: "Unexpected error sending email." };
  }
}

/** Never log a full email address — only enough to correlate in logs
 * without keeping PII there unnecessarily. */
function redactEmail(email: string): string {
  const [local, domain] = email.split("@");
  if (!domain) return "***";
  return `${local?.[0] ?? "*"}***@${domain}`;
}
