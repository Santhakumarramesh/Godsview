/**
 * GodsView Scheduler Baseline Load Test — k6 (Phase 6)
 *
 * Exercises the Phase 5 scheduler status surface + the Phase 6 SLO surface
 * under realistic cron pressure. The dashboard is expected to poll each
 * status endpoint roughly once a second per open client — this test
 * simulates 20 clients sustained for 3 minutes.
 *
 * Run:   k6 run load-tests/k6-scheduler-baseline.js
 * Env:   BASE_URL (default http://localhost:3000)
 *
 * Thresholds are tight on purpose — these endpoints are purely in-memory
 * reads and must stay fast even under a full scheduler tick.
 */
import http from "k6/http";
import { check, group, sleep } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

const errorRate = new Rate("errors");
const govStatusLatency = new Trend("gov_status_latency", true);
const govHistoryLatency = new Trend("gov_history_latency", true);
const calStatusLatency = new Trend("cal_status_latency", true);
const calScoreLatency = new Trend("cal_score_latency", true);
const sloBudgetsLatency = new Trend("slo_budgets_latency", true);
const sloBurnLatency = new Trend("slo_burn_latency", true);

export const options = {
  scenarios: {
    dashboard_poll: {
      executor: "constant-vus",
      vus: 20,
      duration: "3m",
    },
  },
  thresholds: {
    http_req_duration: ["p(95)<500", "p(99)<1500"],
    errors: ["rate<0.01"],
    gov_status_latency: ["p(95)<300"],
    gov_history_latency: ["p(95)<500"],
    cal_status_latency: ["p(95)<300"],
    cal_score_latency: ["p(95)<400"],
    slo_budgets_latency: ["p(95)<500"],
    slo_burn_latency: ["p(95)<400"],
  },
};

function checkOk(res, name) {
  const ok = check(res, { [`${name} status 200`]: (r) => r.status === 200 });
  errorRate.add(!ok);
  return ok;
}

export default function () {
  group("Governance Status Poll", () => {
    const res = http.get(`${BASE}/api/governance/scheduler/status`);
    govStatusLatency.add(res.timings.duration);
    checkOk(res, "gov-status");
  });

  group("Governance History Poll", () => {
    const res = http.get(`${BASE}/api/governance/scheduler/history?limit=50`);
    govHistoryLatency.add(res.timings.duration);
    checkOk(res, "gov-history");
  });

  group("Calibration Status Poll", () => {
    const res = http.get(`${BASE}/api/calibration/scheduler/status`);
    calStatusLatency.add(res.timings.duration);
    checkOk(res, "cal-status");
  });

  group("Calibration Score Poll", () => {
    const res = http.get(`${BASE}/api/calibration/scheduler/score`);
    calScoreLatency.add(res.timings.duration);
    checkOk(res, "cal-score");
  });

  group("SLO Budgets Poll", () => {
    const res = http.get(`${BASE}/api/slo/budgets`);
    sloBudgetsLatency.add(res.timings.duration);
    checkOk(res, "slo-budgets");
  });

  group("SLO Burn Rate Poll", () => {
    const res = http.get(`${BASE}/api/slo/burn-rate`);
    sloBurnLatency.add(res.timings.duration);
    checkOk(res, "slo-burn");
  });

  // ~1s between full poll cycles per VU — matches dashboard behaviour.
  sleep(1.0);
}
