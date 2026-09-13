/**
 * Security headers, applied to every response. These are defense-in-depth
 * — they don't replace the server-side authorization checks in
 * src/server/tenant.ts, but they close off classes of attack the app-level
 * code can't (clickjacking, MIME sniffing, leaking full URLs to third-party
 * referrers, browser features we never use).
 *
 * Content-Security-Policy is NOT set here — it moved to middleware.ts
 * (Phase Q), because a real, per-request nonce is what let script-src
 * drop 'unsafe-inline' (see that file's header comment for the full
 * reasoning). Every OTHER header stays static here — they don't need
 * per-request state, and middleware running on every single request is
 * already the minimum necessary cost for the one header that does.
 */
import { withSentryConfig } from "@sentry/nextjs/config";

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
  },
  // Only meaningful once actually served over HTTPS (any real deployment);
  // harmless to send in local dev over HTTP, where browsers ignore it.
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

// Error tracking (see sentry.server.config.ts / instrumentation-client.ts
// for the actual init calls — this wrapper's only job is build-time
// wiring). Source map upload (Phase Q) is real: org/project below are the
// actual Sentry values, and SENTRY_AUTH_TOKEN (build-time only — never
// exposed to the client, only read by this plugin during `next build`)
// authorizes the upload. Without SENTRY_AUTH_TOKEN set, the plugin logs a
// warning and skips uploading rather than failing the build — same
// graceful-degradation shape as every other integration in this app, so
// a contributor without that secret can still build normally.
// `tunnelRoute` makes the browser SDK post error reports through this
// app's own `/monitoring` path instead of Sentry's ingest host directly
// (see instrumentation-client.ts for why).
export default withSentryConfig(nextConfig, {
  silent: true,
  org: "fable-mm",
  project: "javascript-nextjs",
  authToken: process.env.SENTRY_AUTH_TOKEN,
  tunnelRoute: "/monitoring",
  webpack: { treeshake: { removeDebugLogging: true }, automaticVercelMonitors: false },
});
