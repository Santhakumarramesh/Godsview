#!/usr/bin/env node
/**
 * Run every chaos drill in sequence. Exits non-zero if any failed.
 *
 * Target base URL resolution (in priority order):
 *   1. GODSVIEW_BASE  — full URL (matches scripts/soak/run-48h.sh)
 *   2. PORT + HOST    — legacy port override
 *   3. http://127.0.0.1:3000 — default `pnpm start` port
 *
 * Usage:
 *   node scripts/chaos/run-all.mjs                              # default :3000
 *   GODSVIEW_BASE=http://localhost:3000 node scripts/chaos/run-all.mjs
 *   PORT=5001 HOST=127.0.0.1 node scripts/chaos/run-all.mjs     # legacy
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const drills = [
  "kill-switch-trip.mjs",
  "breaker-trip-blocks-orders.mjs",
  "probe-self-heal.mjs",
  "mesh-degradation.mjs",
  "backtest-roundtrip.mjs",
];

let failed = 0;
const results = [];

for (const drill of drills) {
  const start = Date.now();
  const child = spawn(process.execPath, [join(here, drill)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  });
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const code = await new Promise((resolve) => child.on("close", resolve));
  const ms = Date.now() - start;

  let envelope = null;
  try {
    envelope = JSON.parse(stdout);
  } catch {
    envelope = { drill, parseError: true, stdout, stderr };
  }
  results.push({ drill, code, ms, envelope });
  if (code !== 0) failed++;
}

const summary = {
  ranAt: new Date().toISOString(),
  totalDrills: drills.length,
  passed: drills.length - failed,
  failed,
  results,
};
console.log(JSON.stringify(summary, null, 2));
process.exit(failed > 0 ? 1 : 0);
