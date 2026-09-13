/**
 * Next.js's instrumentation hook — runs once when the server process
 * starts, before any request is handled. Its only job here is loading the
 * right Sentry config for whichever runtime this particular server
 * process is (Node for normal routes/server actions, Edge for anything
 * running there) — see sentry.server.config.ts / sentry.edge.config.ts.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export const onRequestError = async (
  ...args: Parameters<Awaited<typeof import("@sentry/nextjs")>["captureRequestError"]>
) => {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureRequestError(...args);
};
