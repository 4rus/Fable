import * as Sentry from "@sentry/nextjs";

/**
 * Server-side (Node runtime) error tracking. Same "single seam, graceful
 * degradation" pattern as src/lib/email.ts and the storage/AI layers:
 * without SENTRY_DSN set, Sentry.init with an empty dsn is a documented
 * no-op (the SDK stays loaded but never sends anything) — errors just
 * keep going to the stdout logger (src/lib/logger.ts), same as before
 * this file existed.
 *
 * tracesSampleRate is deliberately low (not 0, not 1): this app has no
 * meaningful traffic yet, so performance tracing isn't the point — this
 * is here for error capture. A low sample rate keeps a little visibility
 * into slow requests without paying for/storing full tracing on every
 * request once real traffic exists.
 */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  // Never send this app's real financial data in an error's default
  // request-body capture — errors are for debugging code, not a second
  // copy of customer data. Sentry redacts common auth headers by default;
  // this only affects captured request bodies.
  sendDefaultPii: false,
});
