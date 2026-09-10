"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import AuthShell from "@/components/marketing/AuthShell";
import { checkCredentialsAction } from "@/server/actions/twoFactor";

// useSearchParams() opts the tree it's in out of static prerendering unless
// wrapped in Suspense (Next.js requirement — see
// https://nextjs.org/docs/messages/missing-suspense-with-csr-bailout).
// The fallback renders instantly in practice: this is a client navigation
// in every real flow (the signup redirect, or clicking "Sign in"), so
// there's no meaningful loading window a user would ever see.
export default function LoginPage() {
  return (
    <Suspense fallback={<AuthShellFallback />}>
      <LoginForm />
    </Suspense>
  );
}

function AuthShellFallback() {
  return (
    <AuthShell
      statement="Your business is already generating the answers."
      support="Fable helps you see them — where you stand, what changed, and what deserves your attention today."
    >
      <div className="h-64" aria-hidden />
    </AuthShell>
  );
}

function LoginForm() {
  const router = useRouter();
  const params = useSearchParams();
  const justCreated = params.get("created") === "1";
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  // Once the password step confirms the account has 2FA enabled, we hold
  // onto the (already-verified-once) credentials in memory just long
  // enough to submit them again together with the code — nothing is
  // persisted, and the real signIn() call below still re-verifies the
  // password from scratch server-side, so holding it here isn't a
  // meaningfully larger exposure than the browser already has by virtue
  // of the user having just typed it into this same page.
  const [pendingTwoFactor, setPendingTwoFactor] = useState<{ email: string; password: string } | null>(null);

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "");
    const password = String(form.get("password") ?? "");

    if (pendingTwoFactor) {
      const totpCode = String(form.get("totpCode") ?? "");
      const res = await signIn("credentials", {
        email: pendingTwoFactor.email,
        password: pendingTwoFactor.password,
        totpCode,
        redirect: false,
      });
      setLoading(false);
      if (res?.error) {
        setError("That code isn't right. Check your authenticator app and try again.");
        return;
      }
      router.push("/app");
      router.refresh();
      return;
    }

    const check = await checkCredentialsAction(email, password);
    if (!check.ok) {
      setLoading(false);
      setError(check.error ?? "Incorrect email or password.");
      return;
    }
    if (check.requiresTwoFactor) {
      setLoading(false);
      setPendingTwoFactor({ email, password });
      return;
    }

    const res = await signIn("credentials", { email, password, redirect: false });
    setLoading(false);
    if (res?.error) {
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
      <h1 className="font-serif text-xl tracking-tight text-ink">
        {pendingTwoFactor ? "Enter your code" : "Welcome back"}
      </h1>
      <p className="mt-1 text-sm text-muted">
        {pendingTwoFactor
          ? "Open your authenticator app for the 6-digit code, or use a backup code."
          : "Sign in to see where your business stands."}
      </p>

      {justCreated && !pendingTwoFactor && (
        <p className="mt-4 rounded-lg bg-good-soft px-3 py-2 text-sm text-good">
          Account created. Sign in below.
        </p>
      )}
      {error && (
        <p role="alert" className="mt-4 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">
          {error}
        </p>
      )}

      {pendingTwoFactor ? (
        <form onSubmit={onSubmit} className="mt-6 space-y-4">
          <div>
            <label htmlFor="totpCode" className="field-label">Authentication code</label>
            <input
              id="totpCode"
              name="totpCode"
              type="text"
              inputMode="text"
              autoComplete="one-time-code"
              autoFocus
              required
              placeholder="123456 or a backup code"
              className="field"
            />
          </div>
          <button type="submit" disabled={loading} className="btn-primary w-full">
            {loading ? "Verifying…" : "Verify"}
          </button>
          <button
            type="button"
            onClick={() => {
              setPendingTwoFactor(null);
              setError(null);
            }}
            className="w-full text-center text-xs font-medium text-muted hover:text-ink"
          >
            ← Use a different account
          </button>
        </form>
      ) : (
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
      )}

      {!pendingTwoFactor && (
        <p className="mt-6 text-center text-sm text-muted">
          New here?{" "}
          <Link href="/signup" className="font-medium text-accent hover:underline">
            Create an account
          </Link>
        </p>
      )}
    </AuthShell>
  );
}
