"use client";

import { useFormState, useFormStatus } from "react-dom";
import Link from "next/link";
import { signupAction, type SignupFormState } from "@/server/actions/auth";

const initialState: SignupFormState = {};

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="w-full rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
    >
      {pending ? "Creating account…" : "Create account"}
    </button>
  );
}

export default function SignupPage() {
  const [state, formAction] = useFormState(signupAction, initialState);

  return (
    <main className="mx-auto flex min-h-screen max-w-sm flex-col justify-center px-6">
      <h1 className="mb-1 text-2xl font-semibold text-ink">Set up your business</h1>
      <p className="mb-8 text-sm text-slate-500">
        Two minutes, then you&apos;ll see something useful about your numbers.
      </p>

      {state.error && (
        <p className="mb-4 rounded-md bg-red-50 px-3 py-2 text-sm text-bad">{state.error}</p>
      )}

      <form action={formAction} className="space-y-4">
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

      <p className="mt-6 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-accent hover:underline">
          Sign in
        </Link>
      </p>
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
      <label className="mb-1 block text-sm font-medium text-slate-700">{props.label}</label>
      <input
        name={props.name}
        type={props.type}
        required
        autoComplete={props.autoComplete}
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent"
      />
      {props.hint && <p className="mt-1 text-xs text-slate-400">{props.hint}</p>}
    </div>
  );
}
