import { defineConfig } from "vitest/config";
import path from "path";

export default defineConfig({
  plugins: [
    {
      name: "oxc-tsconfig-override",
      config() {
        return {
          oxc: {
            tsconfig: {
              configFile: path.resolve(__dirname, "tsconfig.json"),
            },
          },
        };
      },
    },
  ],
  test: {
    include: ["src/**/*.test.ts"],
    setupFiles: ["src/__tests__/helpers/setup.ts"],
    environment: "node",
    testTimeout: 15000,
    hookTimeout: 10000,
    env: {
      PORT: "3001",
      NODE_ENV: "test",
      GODSVIEW_SYSTEM_MODE: "paper",
      GODSVIEW_ENABLE_LIVE_TRADING: "false",
    },
  },
});
