#!/usr/bin/env node
// P0-3: Boot readiness check. Prints a table of must-haves before the api-server starts.
// Exits non-zero only if a required artifact is missing for the resolved system mode.

import { existsSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const root = path.resolve(path.dirname(__filename), "..");

function check(label, ok, detail) {
  const status = ok ? "OK " : "MISS";
  return { label, ok, status, detail: detail ?? "" };
}

const distEntry = path.join(root, "artifacts", "api-server", "dist", "index.mjs");
const indexHtml = path.join(root, "artifacts", "api-server", "public", "index.html");

const env = process.env;
const nodeEnv = (env.NODE_ENV ?? "development").toLowerCase();
const systemMode = (env.GODSVIEW_SYSTEM_MODE ?? "paper").toLowerCase();
const port = env.PORT ?? "3000 (default)";
const dataDir = env.GODSVIEW_DATA_DIR ?? "./.runtime (default)";
const corsOrigin = env.CORS_ORIGIN ?? "http://localhost:3000 (default)";
const hasAlpaca = Boolean(env.ALPACA_API_KEY && env.ALPACA_SECRET_KEY);
const hasOperatorToken = Boolean(env.GODSVIEW_OPERATOR_TOKEN);

const results = [
  check("env.NODE_ENV", true, nodeEnv),
  check("env.GODSVIEW_SYSTEM_MODE", true, systemMode),
  check("env.PORT", true, String(port)),
  check("env.GODSVIEW_DATA_DIR", true, dataDir),
  check("env.CORS_ORIGIN", true, corsOrigin),
  check("dist/index.mjs", existsSync(distEntry), distEntry),
  check("public/index.html", existsSync(indexHtml), indexHtml),
  check("Alpaca keys", hasAlpaca, hasAlpaca ? "present" : "absent (paper-fallback)"),
  check("Operator token", hasOperatorToken, hasOperatorToken ? "present" : "absent (live-disabled-only)"),
];

const requiredFor = {
  dist: ["dist/index.mjs", "public/index.html"],
  liveEnabled: ["Alpaca keys", "Operator token"],
};

const missingDist = results
  .filter((r) => requiredFor.dist.includes(r.label) && !r.ok)
  .map((r) => r.label);

const missingLive =
  systemMode === "live_enabled"
    ? results
        .filter((r) => requiredFor.liveEnabled.includes(r.label) && !r.ok)
        .map((r) => r.label)
    : [];

const labelW = Math.max(...results.map((r) => r.label.length));
const detailW = Math.max(...results.map((r) => r.detail.length), 6);
const sep = "+" + "-".repeat(labelW + 2) + "+------+" + "-".repeat(detailW + 2) + "+";

console.log("");
console.log("GodsView boot-check");
console.log(sep);
console.log(
  `| ${"check".padEnd(labelW)} | stat | ${"detail".padEnd(detailW)} |`,
);
console.log(sep);
for (const r of results) {
  console.log(
    `| ${r.label.padEnd(labelW)} | ${r.status} | ${r.detail.padEnd(detailW)} |`,
  );
}
console.log(sep);

if (missingDist.length > 0) {
  console.error(
    `\nboot-check FAILED: missing build artifacts: ${missingDist.join(", ")}.\n` +
      `Run "corepack pnpm run build" first.`,
  );
  process.exit(1);
}
if (missingLive.length > 0) {
  console.error(
    `\nboot-check FAILED: GODSVIEW_SYSTEM_MODE=live_enabled requires: ${missingLive.join(", ")}.`,
  );
  process.exit(1);
}

console.log("boot-check OK — handing off to api-server.\n");
