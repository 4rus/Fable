"use client";

import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { createExpenseAction, type ActionState } from "@/server/actions/expenses";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Saving…" : "Add expense"}
    </button>
  );
}

export default function NewExpenseForm({
  businessId,
  categories,
}: {
  businessId: string;
  categories: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(createExpenseAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="field-surface flex flex-wrap items-end gap-3 p-5">
      <input type="hidden" name="businessId" value={businessId} />
      <div>
        <label htmlFor="expense-vendor" className="field-label">Vendor</label>
        <input id="expense-vendor" name="vendorName" required className="field" />
      </div>
      <div>
        <label htmlFor="expense-amount" className="field-label">Amount ($)</label>
        <input id="expense-amount" name="amountDollars" type="number" min={0.01} step="0.01" required className="field w-28" />
      </div>
      <div>
        <label htmlFor="expense-category" className="field-label">Category</label>
        <select id="expense-category" name="categoryId" required className="field">
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="expense-date" className="field-label">Date</label>
        <input id="expense-date" name="incurredAt" type="date" defaultValue={today} className="field" />
      </div>
      <label className="flex items-center gap-1.5 pb-2.5 text-sm text-muted">
        <input type="checkbox" name="isRecurring" className="rounded border-line" /> Recurring
      </label>
      <SubmitButton />
      {state.error && <p role="alert" className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
