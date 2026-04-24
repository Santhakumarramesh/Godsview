import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";
import path from "path";

// Vitest config is separate from vite.config.ts — minimal config
// that only enables what's needed to render React
// components under jsdom against MSW-mocked fetch.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(
        import.meta.dirname,
        "..",
        "..",
        "attached_assets"
      ),
    },
    dedupe: ["react", "react-dom"],
  },
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.test.{ts,tsx}"],
    css: false,
    // Jsdom does not provide EventSource / window.matchMedia / ResizeObserver
    // by default; setup.ts shims them.
    server: {
      deps: {
        // The Three/React-Three stack is ESM-heavy. We don't exercise it
        // in smoke tests, so allow default transformation.
        inline: [/^@testing-library/],
      },
    },
    reporters: ["dot"],
  },
});
