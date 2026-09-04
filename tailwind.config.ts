import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        charcoal: {
          950: "#0b0d10",
          900: "#12151a",
          800: "#1a1e24",
          700: "#242932",
          600: "#333a45",
        },
        status: {
          good: "#22c55e",
          warn: "#eab308",
          bad: "#ef4444",
        },
        brand: {
          500: "#3b82f6",
          600: "#2563eb",
        },
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "sans-serif"],
      },
    },
  },
  plugins: [],
};
export default config;
