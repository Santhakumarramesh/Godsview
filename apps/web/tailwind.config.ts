import type { Config } from "tailwindcss";

const config: Config = {
  content: [
    "./src/**/*.{ts,tsx,js,jsx,mdx}",
    "../../packages/ui/src/**/*.{ts,tsx}",
  ],
  darkMode: ["class"],
  theme: {
    extend: {
      colors: {
        // Minimal palette — full design tokens land in a later phase.
        border: "hsl(220 13% 20%)",
        background: "hsl(220 25% 7%)",
        surface: "hsl(220 23% 10%)",
        foreground: "hsl(210 20% 96%)",
        muted: "hsl(220 13% 50%)",
        primary: "hsl(199 89% 48%)",
        success: "hsl(142 71% 45%)",
        warn: "hsl(38 92% 50%)",
        danger: "hsl(0 72% 51%)",
      },
      borderRadius: {
        md: "0.5rem",
        lg: "0.75rem",
        xl: "1rem",
      },
      fontFamily: {
        sans: [
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "sans-serif",
        ],
        mono: ["ui-monospace", "SFMono-Regular", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;
