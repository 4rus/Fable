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
  title: "Financial OS",
  description: "Know where your business actually stands.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${fraunces.variable}`}>
      <body className="min-h-screen bg-canvas font-sans antialiased">{children}</body>
    </html>
  );
}
