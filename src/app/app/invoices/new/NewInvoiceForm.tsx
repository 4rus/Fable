"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createInvoiceAction, type ActionState } from "@/server/actions/invoices";

const initialState: ActionState = {};

type Line = { description: string; quantity: number; unitPriceDollars: number };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Creating…" : "Create invoice"}
    </button>
  );
}

export default function NewInvoiceForm({
  businessId,
  customers,
}: {
  businessId: string;
  customers: { id: string; name: string }[];
}) {
  const [state, formAction] = useFormState(createInvoiceAction, initialState);
  const [lines, setLines] = useState<Line[]>([{ description: "", quantity: 1, unitPriceDollars: 0 }]);
  const [taxDollars, setTaxDollars] = useState(0);

  const subtotal = useMemo(
    () => lines.reduce((sum, l) => sum + l.quantity * l.unitPriceDollars, 0),
    [lines],
  );
  const total = subtotal + taxDollars;

  const lineItemsPayload = JSON.stringify(
    lines
      .filter((l) => l.description.trim().length > 0)
      .map((l) => ({
        description: l.description,
        quantity: l.quantity,
        unitPriceCents: Math.round(l.unitPriceDollars * 100),
      })),
  );

  const today = new Date().toISOString().slice(0, 10);
  const inTwoWeeks = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  return (
    <form action={formAction} className="card space-y-5 p-6">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="lineItems" value={lineItemsPayload} />
      <input type="hidden" name="taxCents" value={Math.round(taxDollars * 100)} />

      <div>
        <label className="field-label">Customer</label>
        <select name="customerId" required className="field">
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="field-label">Issue date</label>
          <input type="date" name="issueDate" defaultValue={today} required className="field" />
        </div>
        <div>
          <label className="field-label">Due date</label>
          <input type="date" name="dueDate" defaultValue={inTwoWeeks} required className="field" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="field-label">Line items</label>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <input
              placeholder="Description"
              value={line.description}
              onChange={(e) => updateLine(i, { description: e.target.value })}
              className="field flex-1"
            />
            <input
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
              className="field w-16"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Unit price"
              value={line.unitPriceDollars}
              onChange={(e) => updateLine(i, { unitPriceDollars: Number(e.target.value) })}
              className="field w-28"
            />
            <button
              type="button"
              onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
              className="px-2 text-sm text-slate-400 hover:text-bad"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() => setLines((ls) => [...ls, { description: "", quantity: 1, unitPriceDollars: 0 }])}
          className="text-sm font-medium text-accent hover:underline"
        >
          + Add line
        </button>
      </div>

      <div className="flex items-center justify-end gap-6 border-t border-line pt-4 text-sm">
        <div>
          <span className="text-muted">Subtotal: </span>
          <span className="font-medium tabular-nums text-ink">${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-muted">Tax ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={taxDollars}
            onChange={(e) => setTaxDollars(Number(e.target.value))}
            className="field w-20 px-2 py-1"
          />
        </div>
        <div className="text-base font-semibold tabular-nums text-ink">${total.toFixed(2)}</div>
      </div>

      <div>
        <label className="field-label">Notes (optional)</label>
        <textarea name="notes" rows={2} className="field" />
      </div>

      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      <SubmitButton />
    </form>
  );

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
}
