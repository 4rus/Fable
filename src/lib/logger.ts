import "server-only";
import * as Sentry from "@sentry/nextjs";

/**
 * Minimal structured logger. This is intentionally NOT a full observability
 * solution — it's the one seam where a real one plugs in (Phase C: that's
 * now Sentry, see logError below; sentry.server.config.ts / .edge.config.ts
 * do the actual init). Every call site that matters already goes through
 * here, so swapping or adding another APM later is a one-file change, not
 * a repo-wide hunt.
 *
 * Rules enforced by construction:
 *  - Never log passwords, tokens, session values, or full request bodies.
 *  - Errors shown to users are always generic; the real error (with a
 *    correlation-worthy context object) goes here instead, server-side only.
 */

type LogContext = Record<string, string | number | boolean | null | undefined>;

function write(level: "info" | "warn" | "error", message: string, context?: LogContext) {
  const entry = {
    level,
    message,
    time: new Date().toISOString(),
    ...context,
  };
  // Plain JSON to stdout/stderr. A real setup would ship this to a log
  // aggregator; a container platform's own log capture already picks up
  // stdout/stderr, so this alone is a reasonable v1.
  const line = JSON.stringify(entry);
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const logInfo = (message: string, context?: LogContext) => write("info", message, context);
export const logWarn = (message: string, context?: LogContext) => write("warn", message, context);

/** Call this from a catch block instead of `console.error(err)` directly.
 * Always writes to stdout (unconditionally — that never depended on
 * Sentry being configured); ALSO forwards to Sentry when SENTRY_DSN is
 * set (Sentry.captureException on an unconfigured SDK is a documented
 * no-op, so this is safe to call unconditionally rather than branching
 * on whether it's configured — same graceful-degradation shape as every
 * other integration in this app). */
export function logError(message: string, error: unknown, context?: LogContext) {
  const errorInfo =
    error instanceof Error
      ? { errorName: error.name, errorMessage: error.message }
      : { errorMessage: String(error) };
  write("error", message, { ...context, ...errorInfo });

  Sentry.captureException(error instanceof Error ? error : new Error(String(error)), {
    extra: { message, ...context },
  });
}
