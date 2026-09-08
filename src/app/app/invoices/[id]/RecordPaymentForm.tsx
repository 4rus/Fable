"use client";

import { useFormState, useFormStatus } from "react-dom";
import { recordPaymentAction, type ActionState } from "@/server/actions/invoices";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Recording…" : "Record payment"}
    </button>
  );
}

export default function RecordPaymentForm({
  businessId,
  invoiceId,
  maxDollars,
  idempotencyKey,
}: {
  businessId: string;
  invoiceId: string;
  maxDollars: number;
  idempotencyKey: string;
}) {
  const [state, formAction] = useFormState(recordPaymentAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {/* Regenerated on every server render of this page (new page load =
          genuinely new payment attempt); stable across resubmits of the
          same rendered form so retries can't double-record. */}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Amount ($)</label>
        <input
          name="amountDollars"
          type="number"
          min={0.01}
          max={maxDollars}
          step="0.01"
          defaultValue={maxDollars.toFixed(2)}
          required
          className="w-32 rounded-md border border-slate-300 px-3 py-2 text-sm"
        />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Method</label>
        <select name="method" className="rounded-md border border-slate-300 px-3 py-2 text-sm">
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
          <option value="check">Check</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
        <input name="paidAt" type="date" defaultValue={today} className="rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
