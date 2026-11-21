import type { Config } from "tailwindcss";

// Every colour is a token from app/globals.css (see design-system.md). No raw hex in components.
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "var(--bg)",
        surface: "var(--surface)",
        raised: "var(--raised)",
        fg: "var(--text)",
        muted: "var(--text2)",
        line: "var(--border)",
        "line-strong": "var(--border-strong)",
        accent: { DEFAULT: "var(--accent)", hover: "var(--accent-hover)", subtle: "var(--accent-subtle)", on: "var(--on-accent)" },
        ok: { DEFAULT: "var(--ok)", bg: "var(--ok-bg)" },
        warn: { DEFAULT: "var(--warn)", bg: "var(--warn-bg)" },
        err: { DEFAULT: "var(--err)", bg: "var(--err-bg)" },
      },
      fontFamily: { sans: ["var(--font-sans)", "system-ui", "sans-serif"], mono: ["ui-monospace", "SFMono-Regular", "Menlo", "monospace"] },
      borderRadius: { control: "8px", card: "12px" },
      boxShadow: { float: "0 2px 4px rgb(27 26 23 / 0.06), 0 12px 28px rgb(27 26 23 / 0.12)" },
      transitionTimingFunction: { out: "cubic-bezier(0.16, 1, 0.3, 1)" },
    },
  },
  plugins: [],
};
export default config;
