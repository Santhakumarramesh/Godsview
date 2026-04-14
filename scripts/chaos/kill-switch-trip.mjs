#!/usr/bin/env node
/**
 * Chaos drill: kill-switch trip → recovery
 *
 * Steps:
 *   1. GET /api/ops/v2/kill-switch        → expect active=false
 *   2. POST /api/ops/v2/kill-switch/activate { reason: "chaos drill" }
 *   3. GET /api/ops/v2/kill-switch        → expect active=true, reason set
 *   4. POST /api/ops/v2/kill-switch/deactivate { by: "chaos drill" }
 *   5. GET /api/ops/v2/kill-switch        → expect active=false, tripCount>=1
 */

import { gget, gpost, record, waitForServer } from "./_lib.mjs";

const obs = {};
let passed = true;

if (!(await waitForServer())) {
  record("kill-switch-trip", { error: "server not reachable" }, false);
  process.exit(1);
}

const initial = await gget("/api/ops/v2/kill-switch");
obs.initial = { status: initial.status, active: initial.body?.state?.active };
if (initial.body?.state?.active !== false) passed = false;

const activate = await gpost("/api/ops/v2/kill-switch/activate", { reason: "chaos drill" });
obs.activateStatus = activate.status;
if (!activate.ok) passed = false;

const tripped = await gget("/api/ops/v2/kill-switch");
obs.tripped = {
  status: tripped.status,
  active: tripped.body?.state?.active,
  reason: tripped.body?.state?.reason,
};
if (tripped.body?.state?.active !== true) passed = false;

const deactivate = await gpost("/api/ops/v2/kill-switch/deactivate", { actor: "chaos_drill" });
obs.deactivateStatus = deactivate.status;
if (!deactivate.ok) passed = false;

const final = await gget("/api/ops/v2/kill-switch");
obs.final = {
  status: final.status,
  active: final.body?.state?.active,
  tripCount: final.body?.state?.tripCount,
};
if (final.body?.state?.active !== false) passed = false;
if ((final.body?.state?.tripCount ?? 0) < 1) passed = false;

record("kill-switch-trip", obs, passed);
