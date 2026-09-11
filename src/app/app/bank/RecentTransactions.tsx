import { formatCentsDelta } from "@/lib/money";

interface TransactionRow {
  id: string;
  amountCents: number;
  isoCurrencyCode: string;
  postedDate: Date;
  merchantName: string | null;
  description: string;
  pending: boolean;
  financialAccount: { name: string; mask: string | null };
}

/**
 * Read-only evidence that syncing actually did something — deliberately
 * NOT a categorized/reconciled transaction view (that's Phase G,
 * unbuilt). Plaid's amountCents convention is positive = money out,
 * negative = money in; flipped here (-amountCents) for display so it
 * reads the way people actually expect a ledger to: money out shown
 * with "−", money in shown with "+".
 */
export default function RecentTransactions({ transactions }: { transactions: TransactionRow[] }) {
  if (transactions.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">Recent activity</p>
      <ul className="field-surface mt-3 divide-y divide-line">
        {transactions.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-4 px-4 py-3 text-sm">
            <div className="min-w-0">
              <p className="truncate text-ink">{t.merchantName ?? t.description}</p>
              <p className="mt-0.5 text-xs text-muted">
                {t.postedDate.toLocaleDateString()} · {t.financialAccount.name}
                {t.financialAccount.mask && ` ····${t.financialAccount.mask}`}
                {t.pending && " · Pending"}
              </p>
            </div>
            <span
              className={`shrink-0 tabular-nums ${t.amountCents > 0 ? "text-ink" : "text-good"}`}
            >
              {formatCentsDelta(-t.amountCents, t.isoCurrencyCode)}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
