"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { sendInvoiceAction } from "@/server/actions/invoices";

export default function SendInvoiceButton({
  businessId,
  invoiceId,
}: {
  businessId: string;
  invoiceId: string;
}) {
  const [pending, startTransition] = useTransition();
  const router = useRouter();

  return (
    <button
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          await sendInvoiceAction(businessId, invoiceId);
          router.refresh();
        })
      }
      className="btn-secondary"
    >
      {pending ? "Sending…" : "Mark as sent"}
    </button>
  );
}
