"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { sendInvoiceAction, sendInvoiceEmailAction } from "@/server/actions/invoices";

/**
 * Two ways to "send" an invoice, both real:
 *  - Send by email: actually renders a PDF and emails it to the customer
 *    (src/server/services/invoiceEmail.ts). Requires the customer to have
 *    an email on file and RESEND_API_KEY to be configured.
 *  - Mark as sent: a manual status flip for when the business already
 *    sent it some other way and just wants Fable's record to match
 *    reality — never pretends an email went out.
 */
export default function SendInvoiceButton({
  businessId,
  invoiceId,
  customerHasEmail,
  alreadySent,
}: {
  businessId: string;
  invoiceId: string;
  customerHasEmail: boolean;
  alreadySent: boolean;
}) {
  const [pending, startTransition] = useTransition();
  const [notConfigured, setNotConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const router = useRouter();

  function sendByEmail() {
    setError(null);
    setNotConfigured(false);
    startTransition(async () => {
      const result = await sendInvoiceEmailAction(businessId, invoiceId);
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

  function markSentManually() {
    setError(null);
    startTransition(async () => {
      await sendInvoiceAction(businessId, invoiceId);
      router.refresh();
    });
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <div className="flex items-center gap-2">
        {customerHasEmail ? (
          <button disabled={pending} onClick={sendByEmail} className="btn-primary">
            {pending ? "Sending…" : sent ? "Sent ✓" : alreadySent ? "Resend by email" : "Send by email"}
          </button>
        ) : (
          <Link href="/app/customers" className="text-xs text-muted underline decoration-line hover:text-ink">
            Add an email to this customer to send by email
          </Link>
        )}
        {!alreadySent && (
          <button disabled={pending} onClick={markSentManually} className="btn-ghost text-xs">
            Mark as sent
          </button>
        )}
      </div>

      {notConfigured && (
        <p className="max-w-xs text-right text-xs text-muted">
          Email isn&apos;t configured in this environment yet (no <code>RESEND_API_KEY</code>) — use
          &quot;Mark as sent&quot; if you sent this another way.
        </p>
      )}
      {error && <p className="max-w-xs text-right text-xs text-bad">{error}</p>}
    </div>
  );
}
