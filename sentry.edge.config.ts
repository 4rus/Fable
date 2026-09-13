import * as Sentry from "@sentry/nextjs";

/** Same as sentry.server.config.ts, for code that runs on the Edge
 * runtime (middleware, if any is added later) rather than Node. */
Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  sendDefaultPii: false,
});
