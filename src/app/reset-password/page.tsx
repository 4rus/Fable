"use client";

import { useActionState, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/marketing/AuthShell";
import { resetPasswordAction, type ResetPasswordFormState } from "@/server/actions/auth";

const initialState: ResetPasswordFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? "Resetting…" : "Reset password"}
    </button>
  );
}

export default function ResetPasswordPage() {
  const params = useSearchParams();
  const router = useRouter();
  const token = params.get("token") ?? "";
  const [state, formAction] = useActionState(resetPasswordAction, initialState);

  useEffect(() => {
    if (state.success) {
      const t = setTimeout(() => router.push("/login"), 2500);
      return () => clearTimeout(t);
    }
  }, [state.success, router]);

  return (
    <AuthShell
      statement="A fresh password, same clear picture of your business."
      support="Choose a new password below — you'll be able to sign in right away."
    >
      {!token ? (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          This reset link is missing its token. Request a new one from the{" "}
          <Link href="/forgot-password" className="underline">
            forgot password
          </Link>{" "}
          page.
        </p>
      ) : state.success ? (
        <div>
          <h1 className="font-serif text-xl tracking-tight text-ink">Password reset</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Your password has been updated. Taking you to sign in…
          </p>
        </div>
      ) : (
        <>
          <h1 className="font-serif text-xl tracking-tight text-ink">Set a new password</h1>
          <p className="mt-1 text-sm text-muted">At least 10 characters.</p>

          {state.error && (
            <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
              {state.error}
            </p>
          )}

          <form action={formAction} className="mt-6 space-y-4">
            <input type="hidden" name="token" value={token} />
            <div>
              <label htmlFor="password" className="field-label">New password</label>
              <input
                id="password"
                name="password"
                type="password"
                required
                autoComplete="new-password"
                className="field"
              />
            </div>
            <SubmitButton />
          </form>
        </>
      )}

      <p className="mt-6 text-center text-sm text-muted">
        <Link href="/login" className="font-medium text-accent hover:underline">
          ← Back to sign in
        </Link>
      </p>
    </AuthShell>
  );
}
