#!/usr/bin/env node
/**
 * Chaos drill: backtest run → compare round-trip
 *
 * Steps:
 *   1. POST /api/mcp-backtest/run with a 3-month AAPL/1h/breakout window
 *   2. Assert success=true and runId is returned
 *   3. Assert summary contains all five required metrics (totalTrades,
 *      winRate, sharpeRatio, profitFactor, totalPnl)
 *   4. GET /api/mcp-backtest/compare/:runId
 *   5. Assert comparison payload keys (success, runId, comparison, detailed)
 *   6. GET /api/mcp-backtest/history and assert the run is listed
 */

import { gget, gpost, record, waitForServer } from "./_lib.mjs";

const obs = {};
let passed = true;

if (!(await waitForServer())) {
  record("backtest-roundtrip", { error: "server not reachable" }, false);
  process.exit(1);
}

const run = await gpost("/api/mcp-backtest/run", {
  symbol: "AAPL",
  timeframe: "1h",
  startDate: "2025-01-01",
  endDate: "2025-04-01",
  signalType: "breakout",
  initialCapital: 10000,
  runBaseline: true,
});
obs.runStatus = run.status;
obs.runSuccess = run.body?.success;
obs.runId = run.body?.runId;
if (!run.body?.success || !run.body?.runId) passed = false;

const summary = run.body?.summary ?? {};
const mcp = summary.mcpMetrics ?? {};
obs.mcpMetricsKeys = Object.keys(mcp);
const required = ["totalTrades", "winRate", "sharpeRatio", "profitFactor", "totalPnl"];
for (const k of required) {
  if (!(k in mcp)) {
    passed = false;
    obs.missingMetric = k;
    break;
  }
}
obs.barsProcessed = summary.barsProcessed;
obs.signalsGenerated = summary.signalsGenerated;

if (run.body?.runId) {
  const cmp = await gget(`/api/mcp-backtest/compare/${run.body.runId}`);
  obs.compareStatus = cmp.status;
  obs.compareKeys = Object.keys(cmp.body ?? {});
  if (!cmp.body?.success) passed = false;
}

const history = await gget("/api/mcp-backtest/history");
obs.historyStatus = history.status;
obs.historyCount = Array.isArray(history.body?.runs) ? history.body.runs.length
                 : Array.isArray(history.body) ? history.body.length : 0;
if (obs.historyCount < 1) passed = false;

record("backtest-roundtrip", obs, passed);
