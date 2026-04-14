#!/usr/bin/env node
/**
 * Chaos drill: long-running stability
 *
 * Polls the api-server at 1Hz for a configurable duration (default 60s)
 * and asserts:
 *   - /api/health stays 200 every poll
 *   - /api/engine_health stays healthy for the whole window
 *   - /api/risk/breakers.tripped stays false (no spurious trip)
 *   - Memory RSS from /api/health doesn't grow more than 25% over window
 *
 * Configurable via env:
 *   CHAOS_STABILITY_DURATION_MS   default 60000
 *   CHAOS_STABILITY_POLL_INTERVAL default 1000
 *
 * For a real 48h soak run: CHAOS_STABILITY_DURATION_MS=172800000
 */

import { gget, record, waitForServer } from "./_lib.mjs";

const DURATION_MS = Number(process.env.CHAOS_STABILITY_DURATION_MS ?? 60000);
const POLL_MS = Number(process.env.CHAOS_STABILITY_POLL_INTERVAL ?? 1000);

const obs = { durationMs: DURATION_MS, pollMs: POLL_MS };
let passed = true;

if (!(await waitForServer())) {
  record("long-running-stability", { error: "server not reachable" }, false);
  process.exit(1);
}

const startRss = (await gget("/api/health")).body?.memoryMB ?? 0;
obs.startRssMb = startRss;

let polls = 0;
let healthFails = 0;
let engineFails = 0;
let riskFails = 0;
let peakRss = startRss;

const deadline = Date.now() + DURATION_MS;
while (Date.now() < deadline) {
  polls++;
  const h = await gget("/api/health").catch(() => null);
  if (!h?.ok || h.body?.status !== "ok") healthFails++;
  if (h?.body?.memoryMB && h.body.memoryMB > peakRss) peakRss = h.body.memoryMB;

  const eh = await gget("/api/engine_health").catch(() => null);
  if (!eh?.ok || !["healthy", "operational"].includes(eh.body?.status)) engineFails++;

  const rb = await gget("/api/risk/breakers").catch(() => null);
  if (!rb?.ok || rb.body?.tripped === true) riskFails++;

  await new Promise((r) => setTimeout(r, POLL_MS));
}

obs.polls = polls;
obs.healthFails = healthFails;
obs.engineFails = engineFails;
obs.riskFails = riskFails;
obs.peakRssMb = peakRss;
obs.rssGrowthPct = startRss > 0 ? Math.round(((peakRss - startRss) / startRss) * 100) : 0;

if (healthFails > 0) passed = false;
if (engineFails > 0) passed = false;
if (riskFails > 0) passed = false;
if (obs.rssGrowthPct > 25) passed = false;

record("long-running-stability", obs, passed);
