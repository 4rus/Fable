"use client";

import { useFormState, useFormStatus } from "react-dom";
import { addMemberAction, type ActionState } from "@/server/actions/team";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Adding…" : "Add to team"}
    </button>
  );
}

export default function AddMemberForm({ businessId }: { businessId: string }) {
  const [state, formAction] = useFormState(addMemberAction, initialState);

  return (
    <form action={formAction} className="field-surface space-y-3 p-5">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1">
          <label className="field-label">Email</label>
          <input name="email" type="email" required placeholder="teammate@example.com" className="field" />
        </div>
        <div>
          <label className="field-label">Role</label>
          <select name="role" defaultValue="MEMBER" className="field">
            <option value="MEMBER">Member</option>
            <option value="OWNER">Owner</option>
          </select>
        </div>
        <input type="hidden" name="businessId" value={businessId} />
        <SubmitButton />
      </div>
      <p className="text-xs text-muted">
        They need a Fable account already — this attaches them to your workspace, it
        doesn&apos;t send an email invite yet.
      </p>
      {state.error && <p className="text-sm text-bad">{state.error}</p>}
    </form>
  );
}
