"use client";

import { useRef, useState, useTransition } from "react";
import { useFormStatus } from "react-dom";
import { useActionState } from "react";
import { createExpenseAction, type ActionState } from "@/server/actions/expenses";
import { scanReceiptAction } from "@/server/actions/receiptScan";

const initialState: ActionState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary">
      {pending ? "Saving…" : "Add expense"}
    </button>
  );
}

/**
 * Receipt scanning (feature request, 2026-09): choosing a photo here
 * doesn't submit anything by itself — it calls scanReceiptAction (a plain
 * server call, not a form submission) to get a draft back, then fills in
 * the visible fields below via refs so the user reviews/edits everything
 * before ever clicking "Add expense". The same file stays selected in the
 * hidden `receiptFile` input and rides along with the real form
 * submission, so createExpenseAction can attach it to the expense it
 * creates — one save, not two.
 */
export default function NewExpenseForm({
  businessId,
  categories,
}: {
  businessId: string;
  categories: { id: string; name: string }[];
}) {
  const [state, formAction] = useActionState(createExpenseAction, initialState);
  const today = new Date().toISOString().slice(0, 10);

  const vendorRef = useRef<HTMLInputElement>(null);
  const amountRef = useRef<HTMLInputElement>(null);
  const dateRef = useRef<HTMLInputElement>(null);
  const categoryRef = useRef<HTMLSelectElement>(null);

  const [isScanning, startScan] = useTransition();
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  function handleReceiptChosen(file: File) {
    setScanMessage(null);
    startScan(async () => {
      const formData = new FormData();
      formData.set("businessId", businessId);
      formData.set("file", file);
      const result = await scanReceiptAction(formData);

      if (!result.ok) {
        if (result.reason === "not_configured") {
          setScanMessage("Receipt scanning isn't set up yet — enter the details below by hand.");
        } else {
          setScanMessage(result.message);
        }
        return;
      }

      if (vendorRef.current) vendorRef.current.value = result.vendorName;
      if (amountRef.current) amountRef.current.value = (result.amountCents / 100).toFixed(2);
      if (dateRef.current) dateRef.current.value = result.incurredAt;
      if (categoryRef.current && result.suggestedCategoryId) {
        const match = categories.some((c) => c.id === result.suggestedCategoryId);
        if (match) categoryRef.current.value = result.suggestedCategoryId;
      }
      setScanMessage(
        result.suggestedCategoryName
          ? `Read from receipt — review below, category suggested: ${result.suggestedCategoryName}.`
          : "Read from receipt — review the details below before saving.",
      );
    });
  }

  return (
    <form action={formAction} className="field-surface flex flex-wrap items-end gap-3 p-5">
      <input type="hidden" name="businessId" value={businessId} />

      <div>
        <label className="field-label cursor-pointer text-accent hover:underline">
          📷 Scan a receipt
          <input
            type="file"
            name="receiptFile"
            accept="image/jpeg,image/png"
            className="hidden"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (file) handleReceiptChosen(file);
            }}
          />
        </label>
      </div>

      <div>
        <label htmlFor="expense-vendor" className="field-label">Vendor</label>
        <input id="expense-vendor" name="vendorName" ref={vendorRef} required className="field" />
      </div>
      <div>
        <label htmlFor="expense-amount" className="field-label">Amount ($)</label>
        <input id="expense-amount" name="amountDollars" ref={amountRef} type="number" min={0.01} step="0.01" required className="field w-28" />
      </div>
      <div>
        <label htmlFor="expense-category" className="field-label">Category</label>
        <select id="expense-category" name="categoryId" ref={categoryRef} required className="field">
          {categories.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label htmlFor="expense-date" className="field-label">Date</label>
        <input id="expense-date" name="incurredAt" ref={dateRef} type="date" defaultValue={today} className="field" />
      </div>
      <label className="flex items-center gap-1.5 pb-2.5 text-sm text-muted">
        <input type="checkbox" name="isRecurring" className="rounded border-line" /> Recurring
      </label>
      <SubmitButton />
      {isScanning && <p className="w-full text-xs text-muted">Reading receipt…</p>}
      {!isScanning && scanMessage && <p className="w-full text-xs text-muted">{scanMessage}</p>}
      {state.error && <p role="alert" className="w-full text-sm text-bad">{state.error}</p>}
    </form>
  );
}
