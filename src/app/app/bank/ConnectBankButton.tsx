"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { usePlaidLink } from "react-plaid-link";
import { createLinkTokenAction, completeConnectionAction } from "@/server/actions/bank";

export default function ConnectBankButton({ businessId }: { businessId: string }) {
  const [linkToken, setLinkToken] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  async function start() {
    setError(null);
    setStarting(true);
    const result = await createLinkTokenAction();
    setStarting(false);
    if ("error" in result) {
      setError(result.error);
      return;
    }
    setLinkToken(result.linkToken);
  }

  return (
    <div className="flex flex-col items-end gap-1.5">
      <button onClick={start} disabled={starting || !!linkToken} className="btn-primary">
        {starting ? "Starting…" : "Connect a bank"}
      </button>
      {error && <p className="max-w-xs text-right text-xs text-bad">{error}</p>}
      {linkToken && (
        <PlaidLinkLauncher
          token={linkToken}
          businessId={businessId}
          onDone={() => setLinkToken(null)}
          onError={(msg) => {
            setLinkToken(null);
            setError(msg);
          }}
        />
      )}
    </div>
  );
}

/** Mounted only once a link_token exists — opens Plaid Link automatically
 * the moment it's ready, so "Connect a bank" feels like one click rather
 * than click-then-click-again. */
function PlaidLinkLauncher({
  token,
  businessId,
  onDone,
  onError,
}: {
  token: string;
  businessId: string;
  onDone: () => void;
  onError: (message: string) => void;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const { open, ready } = usePlaidLink({
    token,
    onSuccess: (publicToken) => {
      if (!publicToken) {
        onError("Bank connection didn't complete. Please try again.");
        return;
      }
      startTransition(async () => {
        const result = await completeConnectionAction(businessId, publicToken);
        if ("error" in result) {
          onError(result.error);
          return;
        }
        onDone();
        router.refresh();
      });
    },
    onExit: (err) => {
      if (err) onError("Bank connection was cancelled or failed. Please try again.");
      else onDone();
    },
  });

  useEffect(() => {
    if (ready) open();
  }, [ready, open]);

  return pending ? <p className="text-xs text-muted">Finishing connection…</p> : null;
}
