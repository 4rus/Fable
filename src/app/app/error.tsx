"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Scoped to everything under /app — an error thrown by one page (a bad
 * query, an unexpected null, a real bug) shows this in place of just that
 * page's content, with the sidebar/nav from src/app/app/layout.tsx still
 * visible around it (that layout isn't part of this boundary's own
 * render, Next keeps it mounted) — so a broken page never stops someone
 * from navigating elsewhere in the app. See src/app/error.tsx for the
 * same pattern one level up, for anything outside the app shell.
 */
export default function AppError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center px-6 text-center">
      <h1 className="font-serif text-xl tracking-tight text-ink">This page hit a snag.</h1>
      <p className="mt-2 max-w-sm text-sm text-muted">
        We&apos;ve been notified and are looking into it. Your data is safe — nothing was lost.
      </p>
      <button onClick={reset} className="btn-primary mt-6">
        Try again
      </button>
    </div>
  );
}
