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
