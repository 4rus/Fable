import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-inter)", "ui-sans-serif", "system-ui", "sans-serif"],
      },
      colors: {
        // Neutral scale carries almost all of the UI — color is reserved
        // for the handful of moments that need to interrupt (overdue,
        // critical warnings), not decoration.
        ink: "#0b0f19",
        canvas: "#f7f7f8",
        surface: "#ffffff",
        line: "#e7e7ea",
        muted: "#6b7280",
        accent: {
          DEFAULT: "#3d3ff2",
          hover: "#2f30cf",
          soft: "#eeeefe",
        },
        good: { DEFAULT: "#0f7a4d", soft: "#eafbf3" },
        warn: { DEFAULT: "#a35a00", soft: "#fef6e7" },
        bad: { DEFAULT: "#b3261e", soft: "#fdeeed" },
      },
      boxShadow: {
        card: "0 1px 2px 0 rgb(0 0 0 / 0.03), 0 1px 1px 0 rgb(0 0 0 / 0.02)",
      },
    },
  },
  plugins: [],
};
export default config;
