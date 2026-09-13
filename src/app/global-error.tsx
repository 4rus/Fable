"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * The last-resort error boundary for the whole app — React Router's root
 * layout itself failing to render. Next.js requires this to define its
 * own <html>/<body> (it replaces the root layout entirely when active),
 * so it deliberately doesn't use the app's normal fonts/design system —
 * if we're here, something is broken badly enough that depending on
 * anything else rendering correctly would be optimistic.
 *
 * This is also the one spot src/lib/logger.ts's logError can't cover:
 * a render-time crash never reaches a server catch block, so it's
 * reported to Sentry directly here.
 */
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="en">
      <body style={{ fontFamily: "system-ui, sans-serif", padding: "3rem", maxWidth: 480, margin: "0 auto" }}>
        <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>Something went wrong</h1>
        <p style={{ color: "#666" }}>
          We&apos;ve been notified and are looking into it. Try refreshing the page.
        </p>
      </body>
    </html>
  );
}
