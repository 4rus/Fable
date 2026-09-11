"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { syncNowAction, disconnectConnectionAction } from "@/server/actions/bank";

interface Account {
  id: string;
  name: string;
  mask: string | null;
  type: string;
  subtype: string | null;
  currentBalanceCents: number | null;
  isoCurrencyCode: string;
}

interface Connection {
  id: string;
  institutionName: string | null;
  status: string;
  errorCode: string | null;
  lastSyncedAt: Date | null;
  accounts: Account[];
}

function timeAgo(date: Date): string {
  const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.floor(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

export default function ConnectionCard({
  businessId,
  connection,
  formatBalance,
}: {
  businessId: string;
  connection: Connection;
  formatBalance: (cents: number, currency: string) => string;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  function sync() {
    startTransition(async () => {
      await syncNowAction(businessId, connection.id);
      router.refresh();
    });
  }

  function disconnect() {
    if (!confirm(`Disconnect ${connection.institutionName ?? "this account"}? Past transactions are kept.`)) {
      return;
    }
    startTransition(async () => {
      await disconnectConnectionAction(businessId, connection.id);
      router.refresh();
    });
  }

  if (connection.status === "REVOKED") return null; // kept in the DB for history, never shown as an active connection

  return (
    <div className="field-surface p-5">
      <div className="flex items-start justify-between">
        <div>
          <p className="text-sm font-medium text-ink">{connection.institutionName ?? "Connected account"}</p>
          <p className="mt-0.5 text-xs text-muted">
            {connection.status === "ERROR" ? (
              <span className="text-bad">
                Needs attention{connection.errorCode ? ` (${connection.errorCode})` : ""} — reconnect to
                resume syncing.
              </span>
            ) : connection.lastSyncedAt ? (
              `Synced ${timeAgo(new Date(connection.lastSyncedAt))}`
            ) : (
              "Not synced yet"
            )}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={sync} disabled={pending} className="btn-ghost text-xs">
            {pending ? "Working…" : "Sync now"}
          </button>
          <button onClick={disconnect} disabled={pending} className="btn-ghost text-xs text-bad">
            Disconnect
          </button>
        </div>
      </div>

      {connection.accounts.length > 0 && (
        <ul className="mt-4 divide-y divide-line border-t border-line">
          {connection.accounts.map((a) => (
            <li key={a.id} className="flex items-center justify-between py-2.5 text-sm">
              <span className="text-ink">
                {a.name}
                {a.mask && <span className="text-muted"> ····{a.mask}</span>}
              </span>
              <span className="tabular-nums text-ink">
                {a.currentBalanceCents != null ? formatBalance(a.currentBalanceCents, a.isoCurrencyCode) : "—"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
