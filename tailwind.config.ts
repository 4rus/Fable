import type { Config } from "tailwindcss";

/**
 * DESIGN SYSTEM — decided once, here, and inherited everywhere. Do not
 * introduce one-off colors or ad-hoc font sizes in page components; extend
 * this file instead so the product stays one visual language.
 *
 * Signature: editorial financial intelligence. A warm paper canvas (not
 * cool SaaS gray), a serif for anything the product is "saying" (see
 * layout.tsx — Fraunces), a single deep-green accent used sparingly, and
 * — critically — most of the UI is NOT inside a bordered container.
 * Borders/surfaces are for real groupings (a form, a table of records),
 * not for wrapping every number in a rounded rectangle.
 */
const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
        serif: ["var(--font-fraunces)", "ui-serif", "Georgia", "serif"],
      },
      colors: {
        ink: "#1c1a16",
        canvas: "#f6f4ee",
        surface: "#fffdf9",
        line: "#e7e2d5",
        muted: "#7c7566",
        accent: {
          DEFAULT: "#2b5d45",
          hover: "#1e4633",
          soft: "#e9f0e9",
        },
        good: { DEFAULT: "#3c6b3f", soft: "#eef3e9" },
        warn: { DEFAULT: "#96601c", soft: "#f7f0e2" },
        bad: { DEFAULT: "#9c3b2e", soft: "#f7e9e5" },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.03)",
      },
    },
  },
  plugins: [],
};
export default config;
