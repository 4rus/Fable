"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { formatCentsCompact } from "@/lib/money";
import { formatDate } from "@/lib/dates";
import {
  reconcileExpenseAction,
  matchInvoicePaymentAction,
  ignoreTransactionAction,
} from "@/server/actions/bankReview";
import type { ReviewItem } from "@/server/services/bank/reconciliation";

interface Category {
  id: string;
  name: string;
}

/**
 * "Needs attention" — every synced transaction that isn't reconciled yet.
 * Same plain, typographic list language as ThingsToDo (no card grid, no
 * background-tinted alert widgets), but each row needs an inline action,
 * so it gets a hairline-divided field-surface rather than bare canvas —
 * the same judgment call ConnectionCard already makes for account rows.
 */
export default function TransactionReview({
  businessId,
  items,
  categories,
}: {
  businessId: string;
  items: ReviewItem[];
  categories: Category[];
}) {
  if (items.length === 0) return null;

  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-muted">
        Needs attention · {items.length}
      </p>
      <ul className="field-surface mt-3 divide-y divide-line">
        {items.map((item) =>
          item.type === "expense" ? (
            <ExpenseRow key={item.transaction.id} businessId={businessId} item={item} categories={categories} />
          ) : (
            <DepositRow key={item.transaction.id} businessId={businessId} item={item} />
          ),
        )}
      </ul>
    </div>
  );
}

function ExpenseRow({
  businessId,
  item,
  categories,
}: {
  businessId: string;
  item: Extract<ReviewItem, { type: "expense" }>;
  categories: Category[];
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const defaultCategoryId = item.currentCategory?.id ?? item.suggestedCategory?.id ?? "";
  const [categoryId, setCategoryId] = useState(defaultCategoryId);

  function confirm() {
    if (!categoryId) {
      setError("Pick a category first");
      return;
    }
    setError(null);
    startTransition(async () => {
      const result = await reconcileExpenseAction(businessId, item.transaction.id, categoryId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function ignore() {
    startTransition(async () => {
      const result = await ignoreTransactionAction(businessId, item.transaction.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-ink">{item.transaction.merchantName ?? item.transaction.description}</p>
        <p className="mt-0.5 text-xs text-muted">
          {formatDate(item.transaction.postedDate)} ·{" "}
          {formatCentsCompact(item.transaction.amountCents, item.transaction.isoCurrencyCode)}
          {item.currentCategory && ` · Looks like ${item.currentCategory.name}`}
          {!item.currentCategory && item.suggestedCategory && ` · Might be ${item.suggestedCategory.name}`}
        </p>
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <select
          value={categoryId}
          onChange={(e) => setCategoryId(e.target.value)}
          disabled={pending}
          className="field w-40 text-xs"
        >
          <option value="" disabled>
            Choose category
          </option>
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        <button onClick={confirm} disabled={pending} className="btn-secondary text-xs">
          {pending ? "Working…" : "Add as expense"}
        </button>
        <button onClick={ignore} disabled={pending} className="btn-ghost text-xs">
          Ignore
        </button>
      </div>
    </li>
  );
}

function DepositRow({ businessId, item }: { businessId: string; item: Extract<ReviewItem, { type: "deposit" }> }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function confirm(invoiceId: string) {
    startTransition(async () => {
      const result = await matchInvoicePaymentAction(businessId, item.transaction.id, invoiceId);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  function ignore() {
    startTransition(async () => {
      const result = await ignoreTransactionAction(businessId, item.transaction.id);
      if (result.error) setError(result.error);
      else router.refresh();
    });
  }

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between">
      <div className="min-w-0">
        <p className="truncate text-ink">{item.transaction.merchantName ?? item.transaction.description}</p>
        <p className="mt-0.5 text-xs text-muted">
          {formatDate(item.transaction.postedDate)} ·{" "}
          {formatCentsCompact(-item.transaction.amountCents, item.transaction.isoCurrencyCode)} in
          {item.suggestedInvoice && ` · Looks like Invoice ${item.suggestedInvoice.invoiceNumber} (${item.suggestedInvoice.customerName})`}
          {!item.suggestedInvoice && " · No matching open invoice found"}
        </p>
        {error && <p className="mt-1 text-xs text-bad">{error}</p>}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {item.suggestedInvoice && (
          <button
            onClick={() => confirm(item.suggestedInvoice!.invoiceId)}
            disabled={pending}
            className="btn-secondary text-xs"
          >
            {pending ? "Working…" : "Confirm payment"}
          </button>
        )}
        <button onClick={ignore} disabled={pending} className="btn-ghost text-xs">
          Ignore
        </button>
      </div>
    </li>
  );
}
