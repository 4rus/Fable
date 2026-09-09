"use client";

import { useRef, useTransition, useActionState } from "react";
import { useFormStatus } from "react-dom";
import {
  uploadAttachmentAction,
  deleteAttachmentAction,
  type ActionState,
} from "@/server/actions/attachments";

const initialState: ActionState = {};

function UploadStatus() {
  const { pending } = useFormStatus();
  return pending ? <span className="text-xs text-muted">Uploading…</span> : null;
}

/**
 * Deliberately stateless on the client beyond form-pending status —
 * `attachments` always comes straight from the server-rendered parent
 * page. Both upload and delete revalidate("/app/expenses"), which
 * re-fetches this list from the database; keeping a separate client-side
 * copy would just create a second source of truth that could drift from
 * (or fail to pick up) what actually got saved.
 */
export default function ExpenseAttachments({
  businessId,
  expenseId,
  attachments,
}: {
  businessId: string;
  expenseId: string;
  attachments: { id: string; filename: string }[];
}) {
  const [state, formAction] = useActionState(uploadAttachmentAction, initialState);
  const formRef = useRef<HTMLFormElement>(null);
  const [pendingDelete, startDelete] = useTransition();

  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
      {attachments.map((a) => (
        <span key={a.id} className="inline-flex items-center gap-1 text-xs">
          <a
            href={`/api/attachments/${a.id}`}
            target="_blank"
            rel="noopener noreferrer"
            className="text-accent hover:underline"
          >
            {a.filename}
          </a>
          <button
            type="button"
            disabled={pendingDelete}
            onClick={() => startDelete(() => deleteAttachmentAction(businessId, a.id))}
            className="text-muted hover:text-bad disabled:opacity-50"
            aria-label={`Remove ${a.filename}`}
          >
            ✕
          </button>
        </span>
      ))}

      <form ref={formRef} action={formAction} className="inline-flex items-center gap-2">
        <input type="hidden" name="businessId" value={businessId} />
        <input type="hidden" name="expenseId" value={expenseId} />
        <label className="cursor-pointer text-xs font-medium text-accent hover:underline">
          + Add receipt
          <input
            type="file"
            name="file"
            accept="image/jpeg,image/png,application/pdf"
            className="hidden"
            onChange={() => formRef.current?.requestSubmit()}
          />
        </label>
        <UploadStatus />
      </form>
      {state.error && <p className="w-full text-xs text-bad">{state.error}</p>}
    </div>
  );
}
