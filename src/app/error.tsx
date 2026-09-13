"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Root error boundary — catches an unhandled error anywhere outside a more
 * specific boundary (see src/app/app/error.tsx for the one scoped inside
 * the app shell, which keeps the sidebar visible). Before this existed,
 * an error here fell through to Next.js's default crash screen, and
 * wasn't reported to Sentry at all — this file both looks like Fable and
 * closes that reporting gap (global-error.tsx only catches a crash in the
 * root layout itself, a narrower case).
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="mx-auto flex min-h-screen max-w-md flex-col items-center justify-center px-6 text-center">
      <h1 className="font-serif text-[26px] tracking-tight text-ink">Something went wrong.</h1>
      <p className="mt-2 text-sm text-muted">
        We&apos;ve been notified and are looking into it. Your data is safe — nothing was lost.
      </p>
      <button onClick={reset} className="btn-primary mt-6">
        Try again
      </button>
    </div>
  );
}
