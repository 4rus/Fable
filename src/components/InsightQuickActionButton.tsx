"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendInvoiceReminderAction } from "@/server/actions/invoices";
import type { InsightQuickAction } from "@/server/services/insights";

/**
 * Runs an insight's one-click workflow in place — no navigation, matching
 * how the rest of ThingsToDo reads as a short list rather than a grid of
 * widgets. Currently only "send_invoice_reminder" exists; a new
 * InsightQuickAction variant gets its own case here as it's added
 * (src/server/services/insights.ts owns the union).
 */
export default function InsightQuickActionButton({
  businessId,
  quickAction,
}: {
  businessId: string;
  quickAction: InsightQuickAction;
}) {
  const [pending, startTransition] = useTransition();
  const [state, setState] = useState<"idle" | "sent" | "not_configured" | "error">("idle");
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  function run() {
    setError(null);
    startTransition(async () => {
      if (quickAction.type === "send_invoice_reminder") {
        const result = await sendInvoiceReminderAction(businessId, quickAction.invoiceId);
        if (result.status === "sent") {
          setState("sent");
          router.refresh();
        } else if (result.status === "not_configured") {
          setState("not_configured");
        } else if (result.status === "error") {
          setState("error");
          setError(result.error);
        }
      }
    });
  }

  if (state === "sent") return <span className="text-xs font-medium text-good">Reminder sent ✓</span>;

  return (
    <div className="flex flex-col gap-0.5">
      <button onClick={run} disabled={pending} className="text-left text-xs font-medium text-accent disabled:opacity-60">
        {pending ? "Sending…" : `Send reminder to ${quickAction.customerName} →`}
      </button>
      {state === "not_configured" && (
        <p className="text-xs text-muted">
          Email isn&apos;t configured in this environment yet (no <code>RESEND_API_KEY</code>).
        </p>
      )}
      {state === "error" && error && <p className="text-xs text-bad">{error}</p>}
    </div>
  );
}
