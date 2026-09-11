/**
 * Security headers, applied to every response. These are defense-in-depth
 * — they don't replace the server-side authorization checks in
 * src/server/tenant.ts, but they close off classes of attack the app-level
 * code can't (clickjacking, MIME sniffing, leaking full URLs to third-party
 * referrers, browser features we never use).
 *
 * CSP note: `'unsafe-inline'` is required for script-src because Next.js's
 * App Router streams RSC payloads to the client via small inline <script>
 * tags it injects itself (not something we write) — without a nonce-based
 * setup (which needs middleware.ts generating a per-request nonce), there's
 * no way to allow those without allowing inline scripts generally. That's a
 * real, known gap, not an oversight: tightening this to a nonce-based CSP
 * is documented as follow-up work, not silently skipped. Everything else
 * here IS meaningfully restrictive (no third-party script/frame origins,
 * no plugins, no framing).
 *
 * `'unsafe-eval'` is added ONLY in development: `next dev`'s webpack HMR
 * bundles use eval() for fast source maps, so without it the dev server's
 * own JS fails to run at all (this is what broke the E2E suite, which
 * runs against `next dev`, until this was scoped to dev-only). Production
 * builds don't use eval-based bundling, so the production CSP stays
 * eval-free.
 *
 * Plaid Link (src/app/app/bank/ConnectBankButton.tsx) needs three
 * explicit allowances, per Plaid's own documented CSP requirements
 * (https://plaid.com/docs/link/web/): its script from cdn.plaid.com
 * (script-src), the Link UI itself, which runs in an iframe served from
 * cdn.plaid.com (frame-src), and its own network calls once open,
 * which — since PLAID_ENV can be sandbox/development/production and this
 * header is static, not per-request — allow all three Plaid API hosts
 * rather than only whichever one happens to be configured right now.
 */
const isDev = process.env.NODE_ENV !== "production";

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
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      `script-src 'self' 'unsafe-inline' https://cdn.plaid.com${isDev ? " 'unsafe-eval'" : ""}`,
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      "font-src 'self' data:",
      "connect-src 'self' https://production.plaid.com https://development.plaid.com https://sandbox.plaid.com",
      "frame-src https://cdn.plaid.com",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
