"use client";

import { useFormState, useFormStatus } from "react-dom";
import { recordPaymentAction, type ActionState } from "@/server/actions/invoices";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
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
    <form action={formAction} className="field-surface flex flex-wrap items-end gap-3 p-5">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="invoiceId" value={invoiceId} />
      {/* Regenerated on every server render of this page (new page load =
          genuinely new payment attempt); stable across resubmits of the
          same rendered form so retries can't double-record. */}
      <input type="hidden" name="idempotencyKey" value={idempotencyKey} />

      <div>
        <label className="field-label">Amount ($)</label>
        <input
          name="amountDollars"
          type="number"
          min={0.01}
          max={maxDollars}
          step="0.01"
          defaultValue={maxDollars.toFixed(2)}
          required
          className="field w-32"
        />
      </div>
      <div>
        <label className="field-label">Method</label>
        <select name="method" className="field">
          <option value="bank_transfer">Bank transfer</option>
          <option value="card">Card</option>
          <option value="check">Check</option>
          <option value="cash">Cash</option>
          <option value="other">Other</option>
        </select>
      </div>
      <div>
        <label className="field-label">Date</label>
        <input name="paidAt" type="date" defaultValue={today} className="field" />
      </div>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
