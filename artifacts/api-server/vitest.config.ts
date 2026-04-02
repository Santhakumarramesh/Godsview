import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 10000,
    env: {
      PORT: "3001",
      NODE_ENV: "test",
      CORS_ORIGIN: "http://localhost:5173",
      GODSVIEW_SYSTEM_MODE: "dry_run",
      GODSVIEW_ENABLE_LIVE_TRADING: "false",
    },
  },
});
