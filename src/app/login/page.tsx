"use client";

import { useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/marketing/AuthShell";

export default function LoginPage() {
  const router = useRouter();
  const params = useSearchParams();
  const justCreated = params.get("created") === "1";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const res = await signIn("credentials", {
      email: form.get("email"),
      password: form.get("password"),
      redirect: false,
    });
    setLoading(false);
    if (res?.error) {
      // Generic message — do not reveal whether the email exists.
      setError("Incorrect email or password.");
      return;
    }
    router.push("/app");
    router.refresh();
  }

  return (
    <AuthShell
      statement="Your business is already generating the answers."
      support="Fable helps you see them — where you stand, what changed, and what deserves your attention today."
    >
      <h1 className="font-serif text-xl tracking-tight text-ink">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">Sign in to see where your business stands.</p>

      {justCreated && (
        <p className="mt-4 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          Account created. Sign in below.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      <form onSubmit={onSubmit} className="mt-6 space-y-4">
        <div>
          <label htmlFor="email" className="field-label">Email</label>
          <input id="email" name="email" type="email" required autoComplete="email" className="field" />
        </div>
        <div>
          <div className="flex items-baseline justify-between">
            <label htmlFor="password" className="field-label">Password</label>
            <Link href="/forgot-password" className="mb-1.5 text-xs font-medium text-accent hover:underline">
              Forgot password?
            </Link>
          </div>
          <input
            id="password"
            name="password"
            type="password"
            required
            autoComplete="current-password"
            className="field"
          />
        </div>
        <button type="submit" disabled={loading} className="btn-primary w-full">
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link href="/signup" className="font-medium text-accent hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
