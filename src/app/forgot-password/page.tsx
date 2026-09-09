"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import AuthShell from "@/components/marketing/AuthShell";
import { requestPasswordResetAction, type RequestResetFormState } from "@/server/actions/auth";

const initialState: RequestResetFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? "Sending…" : "Send reset link"}
    </button>
  );
}

export default function ForgotPasswordPage() {
  const [state, formAction] = useFormState(requestPasswordResetAction, initialState);

  return (
    <AuthShell
      statement="Locked out is not the same as locked away."
      support="Tell us the email on your account and we'll get you a way back in."
    >
      {!state.submitted ? (
        <>
          <h1 className="font-serif text-xl tracking-tight text-ink">Reset your password</h1>
          <p className="mt-1 text-sm text-muted">
            We&apos;ll send a link to reset your password.
          </p>

          {state.error && (
            <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {state.error}
            </p>
          )}

          <form action={formAction} className="mt-6 space-y-4">
            <div>
              <label htmlFor="email" className="field-label">Email</label>
              <input id="email" name="email" type="email" required autoComplete="email" className="field" />
            </div>
            <SubmitButton />
          </form>
        </>
      ) : (
        <div>
          <h1 className="font-serif text-xl tracking-tight text-ink">Check your email</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            If an account exists for that address, we&apos;ve sent a link to reset your password.
            It expires in 30 minutes.
          </p>

          {state.resetLink && (
            <div className="mt-5 rounded-lg bg-warn-soft px-4 py-3 text-sm text-warn">
              <p className="font-medium">Development mode</p>
              <p className="mt-1 leading-relaxed">
                No email provider is configured in this environment, so the link isn&apos;t
                actually emailed yet. Use it directly:
              </p>
              <Link href={state.resetLink} className="mt-2 block break-all font-medium underline">
                {state.resetLink}
              </Link>
            </div>
          )}
        </div>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
