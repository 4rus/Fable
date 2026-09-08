"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createExpenseAction, type ActionState } from "@/server/actions/expenses";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
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
  const [state, formAction] = useFormState(createExpenseAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="businessId" value={businessId} />
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Vendor</label>
        <input name="vendorName" required className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Amount ($)</label>
        <input name="amountDollars" type="number" min={0.01} step="0.01" required className="w-28 rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Category</label>
        <select name="categoryId" required className="rounded-md border border-slate-300 px-3 py-1.5 text-sm">
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Date</label>
        <input name="incurredAt" type="date" defaultValue={today} className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
      </div>
      <label className="flex items-center gap-1.5 pb-2 text-sm text-slate-600">
        <input type="checkbox" name="isRecurring" /> Recurring
      </label>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
