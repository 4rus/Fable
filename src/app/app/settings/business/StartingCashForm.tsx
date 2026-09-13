"use client";

import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { confirmStartingCashAction, type ActionState } from "@/server/actions/onboarding";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Saving…" : "Save"}
    </button>
  );
}

export default function StartingCashForm({
  businessId,
  initialAmount,
  initialAsOfDate,
  confirmed,
}: {
  businessId: string;
  initialAmount: string;
  initialAsOfDate: string;
  confirmed: boolean;
}) {
  const action = confirmStartingCashAction.bind(null, businessId);
  const [state, formAction] = useActionState(action, initialState);

  return (
    <form action={formAction} className="field-surface flex flex-wrap items-end gap-3 p-5">
      <div>
        <label htmlFor="starting-cash-amount" className="field-label">Starting cash balance ($)</label>
        <input
          id="starting-cash-amount"
          name="amount"
          type="text"
          inputMode="decimal"
          defaultValue={initialAmount}
          required
          className="field"
        />
      </div>
      <div>
        <label htmlFor="starting-cash-as-of" className="field-label">As of</label>
        <input
          id="starting-cash-as-of"
          name="asOfDate"
          type="date"
          defaultValue={initialAsOfDate}
          required
          className="field"
        />
      </div>
      <SubmitButton />
      {state.error && <p className="w-full text-sm text-bad">{state.error}</p>}
      {!state.error && confirmed && (
        <p className="w-full text-xs text-muted">
          Fable calculates your cash position after this date as this balance, plus payments
          received, minus expenses incurred.
        </p>
      )}
    </form>
  );
}
