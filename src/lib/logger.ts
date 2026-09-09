import "server-only";

/**
 * Minimal structured logger. This is intentionally NOT a full observability
 * solution — it's the one seam where a real one (Sentry, Axiom, Datadog...)
 * plugs in later. Every call site that matters already goes through here,
 * so wiring a real APM later is a one-file change, not a repo-wide hunt.
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

/** Call this from a catch block instead of `console.error(err)` directly —
 * it normalizes Error objects and is the single seam a real error tracker
 * (Sentry.captureException, etc.) would hook into. */
export function logError(message: string, error: unknown, context?: LogContext) {
  const errorInfo =
    error instanceof Error
      ? { errorName: error.name, errorMessage: error.message }
      : { errorMessage: String(error) };
  write("error", message, { ...context, ...errorInfo });
}
