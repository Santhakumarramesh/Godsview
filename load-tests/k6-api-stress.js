/**
 * GodsView API Load Test Suite — k6
 *
 * Run:   k6 run load-tests/k6-api-stress.js
 * Env:   BASE_URL (default http://localhost:3000)
 *
 * Stages: ramp 10→50→100→50→0 VUs over 5 minutes
 */
import http from "k6/http";
import { check, sleep, group } from "k6";
import { Rate, Trend } from "k6/metrics";

const BASE = __ENV.BASE_URL || "http://localhost:3000";

/* ── Custom Metrics ─────────────────────────────────────────────────────────── */
const errorRate = new Rate("errors");
const signalLatency = new Trend("signal_latency", true);
const healthLatency = new Trend("health_latency", true);
const tickerLatency = new Trend("ticker_latency", true);
const brainLatency = new Trend("brain_latency", true);
const govSchedulerLatency = new Trend("gov_scheduler_latency", true);
const calSchedulerLatency = new Trend("cal_scheduler_latency", true);
const sloLatency = new Trend("slo_latency", true);

/* ── Test Configuration ─────────────────────────────────────────────────────── */
export const options = {
  stages: [
    { duration: "30s", target: 10 },
    { duration: "1m", target: 50 },
    { duration: "1m", target: 100 },
    { duration: "1m", target: 50 },
    { duration: "30s", target: 0 },
  ],
  thresholds: {
    http_req_duration: ["p(95)<2000", "p(99)<5000"],
    errors: ["rate<0.05"],
    signal_latency: ["p(95)<1500"],
    health_latency: ["p(95)<500"],
    ticker_latency: ["p(95)<2000"],
    brain_latency: ["p(95)<1000"],
    gov_scheduler_latency: ["p(95)<500", "p(99)<1500"],
    cal_scheduler_latency: ["p(95)<500", "p(99)<1500"],
    slo_latency: ["p(95)<750", "p(99)<2000"],
  },
};

/* ── Helper ─────────────────────────────────────────────────────────────────── */
function checkOk(res, name) {
  const ok = check(res, { [`${name} status 200`]: (r) => r.status === 200 });
  errorRate.add(!ok);
  return ok;
}

/* ── Test Scenarios ─────────────────────────────────────────────────────────── */
export default function () {
  group("Health & Status", () => {
    const res = http.get(`${BASE}/api/health`);
    healthLatency.add(res.timings.duration);
    checkOk(res, "health");
  });

  group("Signal Feed", () => {
    const res = http.get(`${BASE}/api/signals?limit=20`);
    signalLatency.add(res.timings.duration);
    checkOk(res, "signals");
  });

  group("Ticker Prices", () => {
    const res = http.get(`${BASE}/api/alpaca/ticker?symbols=BTCUSD,ETHUSD,AAPL`);
    tickerLatency.add(res.timings.duration);
    checkOk(res, "ticker");
  });

  group("Brain Status", () => {
    const res = http.get(`${BASE}/api/brain/status`);
    brainLatency.add(res.timings.duration);
    checkOk(res, "brain-status");
  });

  group("Streaming Status", () => {
    const res = http.get(`${BASE}/api/streaming/status`);
    checkOk(res, "streaming-status");
  });

  group("Risk Snapshot", () => {
    const res = http.get(`${BASE}/api/risk/snapshot`);
    checkOk(res, "risk-snapshot");
  });

  group("Portfolio Positions", () => {
    const res = http.get(`${BASE}/api/portfolio/positions`);
    checkOk(res, "portfolio-positions");
  });

  group("Performance Metrics", () => {
    const res = http.get(`${BASE}/api/performance/summary`);
    checkOk(res, "performance-summary");
  });

  group("Strategy Registry", () => {
    const res = http.get(`${BASE}/api/strategies`);
    checkOk(res, "strategies");
  });

  group("Audit Trail", () => {
    const res = http.get(`${BASE}/api/audit?limit=10`);
    checkOk(res, "audit");
  });

  group("OpenAPI Spec", () => {
    const res = http.get(`${BASE}/api/docs/spec.json`);
    checkOk(res, "openapi-spec");
  });

  // Phase 6: scheduler endpoints (Phase 5 cron status surface)
  group("Governance Scheduler Status", () => {
    const res = http.get(`${BASE}/api/governance/scheduler/status`);
    govSchedulerLatency.add(res.timings.duration);
    checkOk(res, "gov-scheduler-status");
  });

  group("Governance Scheduler History", () => {
    const res = http.get(`${BASE}/api/governance/scheduler/history?limit=20`);
    govSchedulerLatency.add(res.timings.duration);
    checkOk(res, "gov-scheduler-history");
  });

  group("Calibration Scheduler Status", () => {
    const res = http.get(`${BASE}/api/calibration/scheduler/status`);
    calSchedulerLatency.add(res.timings.duration);
    checkOk(res, "cal-scheduler-status");
  });

  group("Calibration Scheduler Score", () => {
    const res = http.get(`${BASE}/api/calibration/scheduler/score`);
    calSchedulerLatency.add(res.timings.duration);
    checkOk(res, "cal-scheduler-score");
  });

  // Phase 6: SLO surfaces
  group("SLO Definitions", () => {
    const res = http.get(`${BASE}/api/slo/definitions`);
    sloLatency.add(res.timings.duration);
    checkOk(res, "slo-definitions");
  });

  group("SLO Budgets", () => {
    const res = http.get(`${BASE}/api/slo/budgets`);
    sloLatency.add(res.timings.duration);
    checkOk(res, "slo-budgets");
  });

  group("SLO Burn Rate", () => {
    const res = http.get(`${BASE}/api/slo/burn-rate`);
    sloLatency.add(res.timings.duration);
    checkOk(res, "slo-burn-rate");
  });

  sleep(Math.random() * 0.5 + 0.1);
}

/* ── Spike Test (optional, run with: k6 run --tag testtype=spike ...) ───── */
export function spike() {
  const res = http.get(`${BASE}/api/signals?limit=100`);
  checkOk(res, "spike-signals");
  const res2 = http.get(`${BASE}/api/brain/status`);
  checkOk(res2, "spike-brain");
}
