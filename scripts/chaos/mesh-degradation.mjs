#!/usr/bin/env node
/**
 * Chaos drill: service mesh degradation + recovery
 *
 * Steps:
 *   1. GET /api/mesh/services              → expect ≥1 instance (Phase 95 seed)
 *   2. POST /api/mesh/services             → register a synthetic instance
 *   3. GET /api/mesh/services              → expect count++; new instance present
 *   4. POST /api/mesh/services/:id/drain   → mark as draining
 *   5. GET /api/mesh/services              → expect status="draining" on that one
 *   6. DELETE /api/mesh/services/:id       → deregister
 *   7. GET /api/mesh/services              → expect old count restored
 */

import { gget, gpost, record, waitForServer } from "./_lib.mjs";

const obs = {};
let passed = true;

if (!(await waitForServer())) {
  record("mesh-degradation", { error: "server not reachable" }, false);
  process.exit(1);
}

const before = await gget("/api/mesh/services");
const baselineCount = Array.isArray(before.body?.instances) ? before.body.instances.length : 0;
obs.baselineCount = baselineCount;
if (baselineCount < 1) passed = false;

const reg = await gpost("/api/mesh/services", {
  serviceName: "chaos-synthetic",
  host: "127.0.0.1",
  port: 65535,
  version: "1.0.0",
  tags: ["chaos", "synthetic"],
});
obs.registerStatus = reg.status;
const id = reg.body?.id ?? reg.body?.instance?.id;
obs.registeredId = id;
if (!id) passed = false;

const after = await gget("/api/mesh/services");
const afterCount = Array.isArray(after.body?.instances) ? after.body.instances.length : 0;
obs.afterRegisterCount = afterCount;
if (afterCount !== baselineCount + 1) passed = false;

if (id) {
  const drain = await gpost(`/api/mesh/services/${id}/drain`, {});
  obs.drainStatus = drain.status;

  const drained = await gget("/api/mesh/services");
  const ours = drained.body?.instances?.find?.((i) => i.id === id);
  obs.draining = ours?.status;
  if (ours?.status !== "draining") passed = false;

  // Manual fetch with DELETE since _lib doesn't have it
  const delRes = await fetch(`http://${process.env.HOST ?? "127.0.0.1"}:${process.env.PORT ?? "5001"}/api/mesh/services/${id}`, { method: "DELETE" });
  obs.deregisterStatus = delRes.status;

  const final = await gget("/api/mesh/services");
  const finalCount = Array.isArray(final.body?.instances) ? final.body.instances.length : 0;
  obs.finalCount = finalCount;
  if (finalCount !== baselineCount) passed = false;
}

record("mesh-degradation", obs, passed);
