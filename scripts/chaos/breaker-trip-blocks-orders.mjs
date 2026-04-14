#!/usr/bin/env node
/**
 * Chaos drill: kill-switch ON blocks new tv-webhook decisions.
 *
 * With the kill switch active, the system is in a halt state and
 * actionable decisions should not move forward. We can't fully prove
 * "no broker order placed" without live broker keys, so this drill
 * verifies the simpler post-condition:
 *
 *   While kill switch is active, /api/tv-webhook returns ok:true with
 *   action="reject" (or 503 if hard-blocked). It MUST NOT return
 *   action="execute".
 *
 * Steps:
 *   1. activate kill switch
 *   2. POST /api/tv-webhook with a high-quality synthetic signal
 *   3. assert response action != "execute"
 *   4. deactivate kill switch
 */

import { gget, gpost, record, waitForServer } from "./_lib.mjs";

const obs = {};
let passed = true;

if (!(await waitForServer())) {
  record("breaker-trip-blocks-orders", { error: "server not reachable" }, false);
  process.exit(1);
}

await gpost("/api/ops/v2/kill-switch/activate", { reason: "chaos drill" });
const switchState = await gget("/api/ops/v2/kill-switch");
obs.killSwitchActive = switchState.body?.state?.active;
if (switchState.body?.state?.active !== true) passed = false;

const ts = Math.floor(Date.now() / 1000);
const decision = await gpost("/api/tv-webhook", {
  symbol: "AAPL",
  signal: "breakout",
  direction: "long",
  timeframe: "1h",
  price: 175.5,
  timestamp: ts,
  stop_loss: 173,
  take_profit: 180,
  strategy_name: "chaos_drill",
});
obs.decisionStatus = decision.status;
obs.decisionAction = decision.body?.action;
obs.decisionGrade = decision.body?.grade;
obs.rejectionReasons = decision.body?.rejectionReasons;

// Pass condition: NOT execute. reject/watch are both safe.
if (decision.body?.action === "execute") passed = false;

await gpost("/api/ops/v2/kill-switch/deactivate", { actor: "chaos_drill" });

record("breaker-trip-blocks-orders", obs, passed);
