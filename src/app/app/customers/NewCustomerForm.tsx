"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createCustomerAction, type ActionState } from "@/server/actions/customers";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Adding…" : "Add customer"}
    </button>
  );
}

export default function NewCustomerForm({ businessId }: { businessId: string }) {
  const [state, formAction] = useFormState(createCustomerAction, initialState);

  return (
    <form action={formAction} className="flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-white p-4">
      <input type="hidden" name="businessId" value={businessId} />
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Name</label>
        <input name="name" required className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
      </div>
      <div>
        <label className="mb-1 block text-xs font-medium text-slate-500">Email (optional)</label>
        <input name="email" type="email" className="rounded-md border border-slate-300 px-3 py-1.5 text-sm" />
      </div>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
