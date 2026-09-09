"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { LogoMark } from "@/components/icons";
import { signupAction, type SignupFormState } from "@/server/actions/auth";

const initialState: SignupFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} className="btn-primary w-full">
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}

export default function SignupPage() {
  const [state, formAction] = useFormState(signupAction, initialState);

  return (
    <main className="flex min-h-screen items-center justify-center bg-canvas px-6">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex items-center gap-2">
          <LogoMark className="text-ink" />
          <span className="text-[15px] font-semibold tracking-tight text-ink">Fable</span>
        </div>

        <div className="field-surface p-7">
          <h1 className="font-serif text-xl tracking-tight text-ink">Set up your business</h1>
          <p className="mt-1 text-sm text-muted">
            Two minutes, then you&apos;ll see something useful about your numbers.
          </p>

          {state.error && (
            <p className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{state.error}</p>
          )}

          <form action={formAction} className="mt-6 space-y-4">
            <Field name="name" label="Your name" type="text" autoComplete="name" />
            <Field name="email" label="Email" type="email" autoComplete="email" />
            <Field
              name="password"
              label="Password"
              type="password"
              autoComplete="new-password"
              hint="At least 10 characters."
            />
            <Field name="businessName" label="Business name" type="text" autoComplete="organization" />
            <SubmitButton />
          </form>
        </div>

        <p className="mt-6 text-center text-sm text-muted">
          Already have an account?{" "}
          <Link href="/login" className="font-medium text-accent hover:underline">
            Sign in
          </Link>
        </p>
      </div>
    </main>
  );
}

function Field(props: {
  name: string;
  label: string;
  type: string;
  autoComplete: string;
  hint?: string;
}) {
  return (
    <div>
      <label htmlFor={props.name} className="field-label">{props.label}</label>
      <input
        id={props.name}
        name={props.name}
        type={props.type}
        required
        autoComplete={props.autoComplete}
        className="field"
      />
      {props.hint && <p className="mt-1 text-xs text-muted">{props.hint}</p>}
    </div>
  );
}
