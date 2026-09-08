import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./src/**/*.{js,ts,jsx,tsx,mdx}"],
  theme: {
    extend: {
      colors: {
        ink: "#0f172a",
        paper: "#fbfbfa",
        accent: "#2563eb",
        good: "#15803d",
        warn: "#b45309",
        bad: "#b91c1c",
      },
    },
  },
  plugins: [],
};
export default config;
