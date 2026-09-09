"use client";

import { useFormState, useFormStatus } from "react-dom";
import { createCustomerAction, type ActionState } from "@/server/actions/customers";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Adding…" : "Add customer"}
    </button>
  );
}

export default function NewCustomerForm({ businessId }: { businessId: string }) {
  const [state, formAction] = useFormState(createCustomerAction, initialState);

  return (
    <form action={formAction} className="field-surface flex flex-wrap items-end gap-3 p-5">
      <input type="hidden" name="businessId" value={businessId} />
      <div>
        <label htmlFor="customer-name" className="field-label">Name</label>
        <input id="customer-name" name="name" required className="field" />
      </div>
      <div>
        <label htmlFor="customer-email" className="field-label">Email (optional)</label>
        <input id="customer-email" name="email" type="email" className="field" />
      </div>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
