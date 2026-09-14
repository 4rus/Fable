import type { Metadata } from "next";
import { Inter, Fraunces } from "next/font/google";
import "./globals.css";

// The design signature: Fraunces (an editorial serif with real optical
// weight) carries statements and figures — anything the product is
// "saying." Inter carries UI chrome — nav, labels, forms, tables. Two
// voices, used consistently, instead of one uniform sans everywhere.
// See globals.css for the rest of the system (color, spacing, surfaces).
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", display: "swap" });
const fraunces = Fraunces({
  subsets: ["latin"],
  variable: "--font-fraunces",
  display: "swap",
  axes: ["opsz", "SOFT"],
});

export const metadata: Metadata = {
  title: "Fable",
  description: "Know where your business actually stands.",
};

// Real production bug found and fixed during Phase Q's final verification:
// Next.js statically prerenders any page it can (login, signup, forgot/
// reset-password, the legal pages all qualified) — baking ONE fixed nonce
// into that page's HTML at BUILD time. src/middleware.ts generates a
// FRESH nonce on every single real request for the CSP header. Those two
// stop matching the moment a statically-prerendered page's cached HTML is
// served alongside a live request's freshly-generated header — the
// browser correctly refuses to run the (now-mismatched) inline hydration
// scripts, and the page never hydrates: a blank page, confirmed live on
// real production immediately after the CSP migration shipped. Forcing
// every route dynamic guarantees the HTML is generated fresh on each
// request, in the same pass as the nonce that goes into its own CSP
// header — the two can never drift apart. The cost is real but small:
// these are lightweight pages to begin with, and losing Next's static
// prerendering optimization for them is a fair trade for a login page
// that isn't intermittently blank.
export const dynamic = "force-dynamic";

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      {/* suppressHydrationWarning here only covers this element's own
          attributes — it does NOT suppress hydration mismatches in
          children. It's needed because some browser extensions (e.g.
          Grammarly) inject data-* attributes into <body> before React
          hydrates, which otherwise trips a false-positive mismatch
          warning that has nothing to do with our markup. */}
      <body
        className="min-h-screen bg-canvas font-sans antialiased"
        suppressHydrationWarning
      >
        {children}
      </body>
    </html>
  );
}
