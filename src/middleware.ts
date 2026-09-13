import { NextRequest, NextResponse } from "next/server";

/**
 * Generates a fresh per-request nonce and builds the real
 * Content-Security-Policy header here instead of the static one that used
 * to live in next.config.mjs (Phase Q — closing the CSP's one documented
 * gap). A static CSP had no way to allow Next.js's own inline RSC-
 * hydration <script> tags without 'unsafe-inline' in script-src, which
 * would let ANY inline script run, injected or not. A per-request nonce
 * fixes that: Next.js automatically applies whatever nonce shows up in
 * this response's own CSP header to the inline hydration scripts it
 * generates for that same request (built-in behavior, no other wiring
 * needed — see https://nextjs.org/docs/app/building-your-application/configuring/content-security-policy),
 * so only script tags carrying today's nonce can execute. An attacker
 * who manages to inject a `<script>somewhere on the page can't guess a
 * nonce that changes on every single request.
 *
 * style-src keeps 'unsafe-inline' deliberately — Next's automatic nonce
 * propagation is script-only, and Tailwind/Next occasionally emit small
 * inline <style> blocks that aren't practical to nonce here without a
 * real regression risk; that gap is narrower (CSS injection is a much
 * smaller attack surface than script injection) and was never the "real,
 * known gap" this migration is closing.
 */
export function middleware(request: NextRequest) {
  const nonce = btoa(crypto.randomUUID());
  const isDev = process.env.NODE_ENV !== "production";

  const csp = [
    "default-src 'self'",
    // 'unsafe-eval' only in dev: next dev's webpack HMR needs it (see the
    // history of this exact line in next.config.mjs before this file
    // existed — removing it broke E2E, which runs against `next dev`).
    `script-src 'self' 'nonce-${nonce}' https://cdn.plaid.com${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self' data:",
    "connect-src 'self' https://production.plaid.com https://development.plaid.com https://sandbox.plaid.com",
    "frame-src https://cdn.plaid.com",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");

  // Set on the outgoing request too, not just the response — this is how
  // Server Components downstream (via next/headers' headers()) can read
  // the SAME nonce if this app ever needs to nonce one of its own
  // explicit <script> tags later (none exist today; Next's automatic
  // hydration-script nonce propagation, described above, needs nothing
  // else from here).
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("Content-Security-Policy", csp);

  const response = NextResponse.next({ request: { headers: requestHeaders } });
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  // Every route except static assets — same scope the old
  // next.config.mjs headers() entry covered ("/:path*"), minus the
  // things a nonce-based per-request CSP can't meaningfully apply to
  // anyway (they're not HTML documents).
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
