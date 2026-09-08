"use client";

import { useMemo, useState } from "react";
import { useFormState, useFormStatus } from "react-dom";
import { createInvoiceAction, type ActionState } from "@/server/actions/invoices";

const initialState: ActionState = {};

type Line = { description: string; quantity: number; unitPriceDollars: number };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
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
    <form action={formAction} className="space-y-5">
      <input type="hidden" name="businessId" value={businessId} />
      <input type="hidden" name="lineItems" value={lineItemsPayload} />
      <input type="hidden" name="taxCents" value={Math.round(taxDollars * 100)} />

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Customer</label>
        <select name="customerId" required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm">
          {customers.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Issue date</label>
          <input type="date" name="issueDate" defaultValue={today} required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-slate-500">Due date</label>
          <input type="date" name="dueDate" defaultValue={inTwoWeeks} required className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
        </div>
      </div>

      <div className="space-y-2">
        <label className="block text-xs font-medium text-slate-500">Line items</label>
        {lines.map((line, i) => (
          <div key={i} className="flex gap-2">
            <input
              placeholder="Description"
              value={line.description}
              onChange={(e) => updateLine(i, { description: e.target.value })}
              className="flex-1 rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
            <input
              type="number"
              min={1}
              value={line.quantity}
              onChange={(e) => updateLine(i, { quantity: Number(e.target.value) })}
              className="w-16 rounded-md border border-slate-300 px-2 py-2 text-sm"
            />
            <input
              type="number"
              min={0}
              step="0.01"
              placeholder="Unit price"
              value={line.unitPriceDollars}
              onChange={(e) => updateLine(i, { unitPriceDollars: Number(e.target.value) })}
              className="w-28 rounded-md border border-slate-300 px-2 py-2 text-sm"
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

      <div className="flex items-center justify-end gap-6 border-t border-slate-100 pt-4 text-sm">
        <div>
          <span className="text-slate-500">Subtotal: </span>
          <span className="font-medium tabular-nums">${subtotal.toFixed(2)}</span>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-slate-500">Tax ($)</label>
          <input
            type="number"
            min={0}
            step="0.01"
            value={taxDollars}
            onChange={(e) => setTaxDollars(Number(e.target.value))}
            className="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <div className="text-base font-semibold tabular-nums">${total.toFixed(2)}</div>
      </div>

      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Notes (optional)</label>
        <textarea name="notes" rows={2} className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm" />
      </div>

      {state.error && <p className="text-sm text-bad">{state.error}</p>}
      <SubmitButton />
    </form>
  );

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }
}
