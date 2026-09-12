"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendInvoiceReminderAction } from "@/server/actions/invoices";

/** A real reminder email — see src/server/services/reminderEmail.ts.
 * Only rendered by the caller when the invoice is SENT/PARTIALLY_PAID
 * with a real balance due; this component doesn't re-check eligibility,
 * it just surfaces whatever the server decides (including the rate-limit
 * message if one was already sent recently). */
export default function SendReminderButton({
  businessId,
  invoiceId,
  lastReminderSentAtLabel,
}: {
  businessId: string;
  invoiceId: string;
  /** Pre-formatted server-side (see the invoice detail page) — never
   * format a Date directly in this component, which would re-run during
   * client hydration and can mismatch the server-rendered HTML if the
   * server and browser locales differ. */
  lastReminderSentAtLabel: string | null;
}) {
  const [pending, startTransition] = useTransition();
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  function send() {
    setError(null);
    setNotConfigured(false);
    startTransition(async () => {
      const result = await sendInvoiceReminderAction(businessId, invoiceId);
      if (result.status === "sent") {
        setSent(true);
        router.refresh();
      } else if (result.status === "not_configured") {
        setNotConfigured(true);
      } else if (result.status === "error") {
        setError(result.error);
      }
    });
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <button disabled={pending} onClick={send} className="btn-ghost text-xs">
        {pending ? "Sending…" : sent ? "Reminder sent ✓" : "Send reminder"}
      </button>
      {!sent && !error && !notConfigured && lastReminderSentAtLabel && (
        <p className="text-xs text-muted">Last sent {lastReminderSentAtLabel}</p>
      )}
      {notConfigured && (
        <p className="max-w-xs text-right text-xs text-muted">
          Email isn&apos;t configured in this environment yet (no <code>RESEND_API_KEY</code>).
        </p>
      )}
      {error && <p className="max-w-xs text-right text-xs text-bad">{error}</p>}
    </div>
  );
}
