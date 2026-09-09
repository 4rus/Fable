"use client";

import { useState, useTransition, useActionState } from "react";
import { useRouter } from "next/navigation";
import { useFormStatus } from "react-dom";
import { switchBusinessAction, createBusinessAction, type ActionState } from "@/server/actions/businesses";

interface BusinessOption {
  id: string;
  name: string;
}

const initialState: ActionState = {};

export default function WorkspaceSwitcher({
  businesses,
  activeBusinessId,
}: {
  businesses: BusinessOption[];
  activeBusinessId: string;
}) {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [pending, startTransition] = useTransition();
  const router = useRouter();
  const active = businesses.find((b) => b.id === activeBusinessId) ?? businesses[0]!;

  function switchTo(id: string) {
    if (id === activeBusinessId) {
      setOpen(false);
      return;
    }
    startTransition(async () => {
      await switchBusinessAction(id);
      setOpen(false);
      router.refresh();
    });
  }

  return (
    <div className="relative px-3 pb-4">
      <button
        onClick={() => setOpen((v) => !v)}
        disabled={pending}
        className="flex w-full items-center justify-between rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-canvas disabled:opacity-60"
      >
        <span className="min-w-0">
          <span className="block truncate text-[13px] font-medium text-ink">{active.name}</span>
          <span className="block text-[11px] text-muted">Workspace</span>
        </span>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="shrink-0 text-muted">
          <path d="M7 10l5 5 5-5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open && (
        <div className="absolute left-3 right-3 top-full z-10 mt-1 rounded-lg border border-line bg-surface py-1 shadow-card">
          {businesses.map((b) => (
            <button
              key={b.id}
              onClick={() => switchTo(b.id)}
              className={
                "flex w-full items-center justify-between px-3 py-2 text-left text-[13px] hover:bg-canvas " +
                (b.id === activeBusinessId ? "text-ink" : "text-muted")
              }
            >
              <span className="truncate">{b.name}</span>
              {b.id === activeBusinessId && <span className="ml-2 text-accent">✓</span>}
            </button>
          ))}

          <div className="my-1 border-t border-line" />

          {creating ? (
            <CreateBusinessForm onDone={() => setCreating(false)} />
          ) : (
            <button
              onClick={() => setCreating(true)}
              className="flex w-full items-center gap-1.5 px-3 py-2 text-left text-[13px] text-muted hover:bg-canvas hover:text-ink"
            >
              + Add a workspace
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="text-xs font-medium text-accent disabled:opacity-50">
      {pending ? "Creating…" : "Create"}
    </button>
  );
}

function CreateBusinessForm({ onDone }: { onDone: () => void }) {
  const [state, formAction] = useActionState(createBusinessAction, initialState);

  return (
    <form action={formAction} className="px-3 py-2">
      <label className="mb-1 block text-[11px] text-muted">Business name</label>
      <div className="flex items-center gap-2">
        <input
          name="name"
          required
          autoFocus
          className="field flex-1 px-2 py-1 text-[13px]"
          placeholder="e.g. Riverside Landscaping"
        />
        <SubmitButton />
      </div>
      {state.error && <p className="mt-1 text-xs text-bad">{state.error}</p>}
      <button type="button" onClick={onDone} className="mt-1 text-xs text-muted hover:text-ink">
        Cancel
      </button>
    </form>
  );
}
