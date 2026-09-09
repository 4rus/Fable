"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useFormState, useFormStatus } from "react-dom";
import {
  previewCsvImportAction,
  commitCsvImportAction,
  type PreviewState,
  type CommitState,
  type PreviewRow,
} from "@/server/actions/csvImport";
import { formatCents } from "@/lib/money";

const initialPreviewState: PreviewState = {};
const initialCommitState: CommitState = {};

function PreviewSubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Reading file…" : "Preview import"}
    </button>
  );
}

function CommitSubmitButton({ count }: { count: number }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || count === 0} className="btn-primary">
      {pending ? "Importing…" : `Import ${count} expense${count === 1 ? "" : "s"}`}
    </button>
  );
}

export default function ImportForm({
  businessId,
  categories,
}: {
  businessId: string;
  categories: { id: string; name: string }[];
}) {
  const [previewState, previewAction] = useFormState(previewCsvImportAction, initialPreviewState);
  const [commitState, commitAction] = useFormState(commitCsvImportAction, initialCommitState);
  const [included, setIncluded] = useState<Record<number, boolean>>({});
  const [categoryId, setCategoryId] = useState(categories[0]?.id ?? "");

  const rows: PreviewRow[] = previewState.preview?.rows ?? [];

  // Reset selection whenever a fresh preview comes in (new file uploaded).
  useMemo(() => {
    if (rows.length > 0) {
      setIncluded(Object.fromEntries(rows.map((_, i) => [i, true])));
    }
  }, [rows.length]); // eslint-disable-line react-hooks/exhaustive-deps

  const includedRows = rows.filter((_, i) => included[i]);
  const rowsPayload = JSON.stringify(includedRows);

  if (commitState.result) {
    return (
      <div className="field-surface p-6 text-center">
        <p className="font-serif text-lg text-ink">
          Imported {commitState.result.createdCount} expense{commitState.result.createdCount === 1 ? "" : "s"}
        </p>
        {commitState.result.duplicateCount > 0 && (
          <p className="mt-1 text-sm text-muted">
            Skipped {commitState.result.duplicateCount} that looked like duplicates of expenses already
            on file.
          </p>
        )}
        <Link href="/app/expenses" className="btn-secondary mt-4 inline-flex">
          Back to expenses
        </Link>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <form action={previewAction} className="field-surface space-y-4 p-6">
        <input type="hidden" name="businessId" value={businessId} />
        <div>
          <label htmlFor="csv-file" className="field-label">CSV file</label>
          <input id="csv-file" type="file" name="file" accept=".csv,text/csv" required className="field" />
        </div>
        {previewState.error && <p className="text-sm text-bad">{previewState.error}</p>}
        <PreviewSubmitButton />
      </form>
    );
  }

  return (
    <form action={commitAction} className="space-y-4">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="categoryId" value={categoryId} />
      <input type="hidden" name="rows" value={rowsPayload} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted">
          Found {rows.length} expense{rows.length === 1 ? "" : "s"}
          {previewState.preview!.skippedIncomeCount > 0 &&
            ` · ${previewState.preview!.skippedIncomeCount} deposit${previewState.preview!.skippedIncomeCount === 1 ? "" : "s"} skipped (match those to an invoice manually)`}
          {previewState.preview!.skippedInvalidCount > 0 &&
            ` · ${previewState.preview!.skippedInvalidCount} row${previewState.preview!.skippedInvalidCount === 1 ? "" : "s"} couldn't be read`}
        </p>
        <div className="flex items-center gap-2">
          <label htmlFor="import-category" className="text-xs text-muted">
            Category for all imported rows
          </label>
          <select
            id="import-category"
            value={categoryId}
            onChange={(e) => setCategoryId(e.target.value)}
            className="field w-auto py-1"
          >
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </div>
      </div>

      <div className="max-h-96 overflow-y-auto rounded-xl border border-line">
        <table className="w-full text-sm">
          <thead className="sticky top-0 bg-surface">
            <tr className="text-left text-xs uppercase tracking-wide text-muted">
              <th className="px-4 py-2 font-medium"></th>
              <th className="px-4 py-2 font-medium">Date</th>
              <th className="px-4 py-2 font-medium">Vendor</th>
              <th className="px-4 py-2 text-right font-medium">Amount</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((row, i) => (
              <tr key={i}>
                <td className="px-4 py-2">
                  <input
                    type="checkbox"
                    checked={!!included[i]}
                    onChange={(e) => setIncluded((prev) => ({ ...prev, [i]: e.target.checked }))}
                    className="rounded border-line"
                    aria-label={`Include ${row.vendorName}`}
                  />
                </td>
                <td className="px-4 py-2 text-muted">{new Date(row.incurredAt).toLocaleDateString()}</td>
                <td className="px-4 py-2 text-ink">{row.vendorName}</td>
                <td className="px-4 py-2 text-right tabular-nums text-ink">{formatCents(row.amountCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {commitState.error && <p className="text-sm text-bad">{commitState.error}</p>}
      <CommitSubmitButton count={includedRows.length} />
    </form>
  );
}
