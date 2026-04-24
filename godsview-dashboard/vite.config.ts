import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import path from "path";

// Replit plugins — optional, only loaded when running inside Replit
const replitPlugins: any[] = [];
if (process.env.REPL_ID !== undefined) {
  try {
    const { default: runtimeErrorOverlay } = await import(
      "@replit/vite-plugin-runtime-error-modal"
    );
    replitPlugins.push(runtimeErrorOverlay());
    if (process.env.NODE_ENV !== "production") {
      const { cartographer } = await import(
        "@replit/vite-plugin-cartographer"
      );
      replitPlugins.push(cartographer({ root: path.resolve(import.meta.dirname, "..") }));
      const { devBanner } = await import("@replit/vite-plugin-dev-banner");
      replitPlugins.push(devBanner());
    }
  } catch {
    // Replit plugins not installed — skip silently (Docker / local builds)
  }
}

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
    ...replitPlugins,
  ],
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "src"),
      "@assets": path.resolve(import.meta.dirname, "..", "..", "attached_assets"),
      // Fallback: if @workspace/api-client-react isn't resolved by pnpm workspace,
      // use the local shim so standalone / Docker builds still succeed.
      ...(!process.env.npm_package_name && {
        "@workspace/api-client-react": path.resolve(import.meta.dirname, "src/lib/api-client-shim.ts"),
      }),
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
    emptyOutDir: true,
    // Route-level splitting is already provided by the router; avoid brittle manual chunk wiring.
    chunkSizeWarningLimit: 1800,
  },
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/health": {
        target: "http://localhost:3001",
        changeOrigin: true,
      },
      "/streaming": {
        target: "http://localhost:3001",
        changeOrigin: true,
        ws: true,
      },
    },
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
