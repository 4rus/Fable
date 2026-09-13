import * as Sentry from "@sentry/nextjs";

/**
 * Browser-side error tracking. Next.js auto-loads this file before
 * hydration when it exists (no manual wiring needed) — see
 * sentry.server.config.ts for the reasoning shared with this file
 * (graceful no-op without SENTRY_DSN, low trace sample rate, no PII).
 *
 * `tunnel` routes error reports through this app's own domain
 * (`/monitoring`, wired up by withSentryConfig in next.config.mjs)
 * instead of the browser calling Sentry's ingest host directly — keeps
 * this app's Content-Security-Policy free of a third-party connect-src
 * entry, and is unaffected by ad-blockers that target Sentry's domain.
 */
Sentry.init({
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
  tunnel: "/monitoring",
});

// Required by the SDK to capture client-side route transitions (App
// Router navigation) as part of tracing.
export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
