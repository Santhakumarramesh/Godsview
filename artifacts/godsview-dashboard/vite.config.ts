import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

const rawPort = process.env.PORT ?? "5173";

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

const basePath = process.env.BASE_PATH ?? "/";

export default defineConfig({
  base: basePath,
  plugins: [
    react(),
    tailwindcss(),
    runtimeErrorOverlay(),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer({
              root: path.resolve(import.meta.dirname, ".."),
            }),
          ),
          await import("@replit/vite-plugin-dev-banner").then((m) =>
            m.devBanner(),
          ),
        ]
      : []),
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
    },
    dedupe: ["react", "react-dom"],
  },
  root: path.resolve(import.meta.dirname),
  css: {
    // Use esbuild transformer as fallback when lightningcss native binary is unavailable
    // (e.g. aarch64 sandbox). Docker build (linux/amd64) uses lightningcss natively.
    transformer: "postcss",
  },
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: false,
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks(id) {
          // Must test most-specific paths first to avoid circular chunk issues.
          // Rule: each id should match at most one bucket.

          // React core
          if (/node_modules\/react(-dom)?\//.test(id)) return "vendor-react";

          // Charting
          if (/node_modules\/(recharts|lightweight-charts|d3-)/.test(id)) return "vendor-charts";

          // Radix UI
          if (id.includes("node_modules/@radix-ui/")) return "vendor-radix";

          // TanStack
          if (id.includes("node_modules/@tanstack/")) return "vendor-query";

          // Framer Motion
          if (id.includes("node_modules/framer-motion")) return "vendor-motion";

          // Zod + react-hook-form — small, used everywhere
          if (/node_modules\/(zod|react-hook-form|@hookform)/.test(id)) return "vendor-forms";

          // Date utilities
          if (/node_modules\/(date-fns|dayjs|luxon)/.test(id)) return "vendor-dates";

          // Lucide icons
          if (id.includes("node_modules/lucide-react")) return "vendor-icons";

          // Everything else in node_modules
          if (id.includes("node_modules/")) return "vendor-misc";
        },
      },
    },
  },
  server: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
    fs: {
      strict: true,
      deny: ["**/.*"],
    },
  },
  preview: {
    port,
    host: "0.0.0.0",
    allowedHosts: true,
  },
});
