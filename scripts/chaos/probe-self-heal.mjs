#!/usr/bin/env node
/**
 * Chaos drill: self-heal probe enumeration + run-all
 *
 * Steps:
 *   1. GET /api/heal/probes              → expect at least one probe registered
 *   2. POST /api/heal/probes/run-all     → expect ok response with findings list
 *   3. GET /api/heal/findings            → expect list (may be empty)
 *   4. GET /api/heal/recommendations     → expect list (may be empty)
 */

import { gget, gpost, record, waitForServer } from "./_lib.mjs";

const obs = {};
let passed = true;

if (!(await waitForServer())) {
  record("probe-self-heal", { error: "server not reachable" }, false);
  process.exit(1);
}

const probes = await gget("/api/heal/probes");
obs.probesStatus = probes.status;
obs.probesCount = Array.isArray(probes.body?.probes) ? probes.body.probes.length : 0;
obs.probes = probes.body?.probes;
if (obs.probesCount < 1) passed = false;

const runAll = await gpost("/api/heal/probes/run-all", {});
obs.runAllStatus = runAll.status;
if (runAll.status >= 500) passed = false;

const findings = await gget("/api/heal/findings");
obs.findingsStatus = findings.status;
obs.findingsCount = Array.isArray(findings.body?.findings) ? findings.body.findings.length
                  : Array.isArray(findings.body) ? findings.body.length
                  : 0;

const recs = await gget("/api/heal/recommendations");
obs.recommendationsStatus = recs.status;
if (recs.status >= 500) passed = false;

record("probe-self-heal", obs, passed);
