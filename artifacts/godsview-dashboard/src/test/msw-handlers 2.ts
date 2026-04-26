/**
 * MSW handlers — default responses for dashboard smoke tests.
 *
 * Philosophy: smoke tests want to confirm a page renders without throwing.
 * We don't need every endpoint to return pixel-perfect data — we just need
 * every endpoint to return a well-formed JSON shape the query hooks can
 * consume without crashing the render tree.
 *
 * Strategy:
 *   1. Specific handlers for endpoints where the shape matters (alerts
 *      summary, active feed, strategies list, etc.) so the rendered DOM
 *      contains predictable text we can assert on.
 *   2. A catch-all for any other `/api/*` GET that returns an empty object
 *      or empty array based on path heuristics. Keeps smoke tests from
 *      failing when a page fans out to ten endpoints we haven't mocked.
 *
 * Override any handler in a single test with:
 *
 *     server.use(http.get("/api/alerts/summary", () => HttpResponse.json({...})));
 */
import { http, HttpResponse } from "msw";

// ── Alert Center — Phase 8/9 shapes ──────────────────────────────────────
const alertSummaryDefault = {
  totalActive: 3,
  p1Critical: 1,
  p2High: 1,
  acknowledged: 0,
  escalated: 0,
  healthScore: 92,
};

const alertActiveFeedDefault = {
  alerts: [
    {
      id: "alert-test-1",
      type: "daily_loss_breach",
      severity: "fatal",
      message: "Synthetic test alert",
      timestamp: new Date().toISOString(),
      details: { source: "msw" },
    },
  ],
};

// Shape matches artifacts/api-server/src/routes/alerts.ts `/alerts/channels`
// output exactly: id, name, type, status, messagesSent, failureRate (as %),
// lastSent (ISO or null), priority, enabled.
const alertChannelsDefault = [
  {
    id: "ch_dashboard",
    name: "Dashboard",
    type: "dashboard",
    status: "active",
    messagesSent: 0,
    failureRate: 0,
    lastSent: null,
    priority: "all",
    enabled: true,
  },
  {
    id: "ch_log",
    name: "Structured Log",
    type: "log",
    status: "active",
    messagesSent: 0,
    failureRate: 0,
    lastSent: null,
    priority: "all",
    enabled: true,
  },
  {
    id: "ch_webhook",
    name: "Configured Webhook",
    type: "webhook",
    status: "active",
    messagesSent: 0,
    failureRate: 0,
    lastSent: null,
    priority: "P1-P3",
    enabled: true,
  },
];

const alertEscalationDefault = [
  { level: 1, channel: "Dashboard, Log, SSE Router", delay: "0m", active: true },
  { level: 2, channel: "Webhook (Slack / PagerDuty)", delay: "0m", active: true },
  { level: 3, channel: "On-call rotation", delay: "5m", active: false },
];

const alertRulesDefault = [
  {
    id: "rule-1",
    name: "daily_loss_breach",
    priority: "P1",
    category: "Risk",
    enabled: true,
    conditions: "daily_pnl <= -limit",
    triggerCount: 0,
    lastTriggered: null,
  },
];

const alertAnomaliesDefault = {
  metrics: [
    { id: "m1", name: "Trade Volume", current: 120, baseline: 100, zScore: 1.2, anomalous: false },
  ],
  recent: [],
};

// ── Strategies / governance shapes ──────────────────────────────────────
const strategiesDefault = {
  strategies: [
    { id: "s1", name: "Breakout Reversion", status: "paper", sharpe: 1.42 },
  ],
};

const governanceSchedulerStatusDefault = {
  status: "ok",
  lastRunAt: new Date().toISOString(),
  running: true,
  intervalMs: 3_600_000,
};

const sloBudgetsDefault = {
  snapshot: [
    {
      id: "general_availability",
      title: "API general availability",
      tier: "high",
      sampleCount: 10,
      goodCount: 10,
      budgetRemaining: 1.0,
    },
  ],
};

const sloRouterStatusDefault = {
  router: {
    running: true,
    forwardedCount: 0,
    lastForwardTs: null,
  },
};

// ── Proof Dashboard — shape matches proof.tsx `ProofDashboardData` ───────
const proofDashboardDefault = {
  summary: {
    overall_win_rate: 0.68,
    total_trades: 42,
    profit_factor: 1.85,
    sharpe_ratio: 1.42,
    best_strategy: { name: "Breakout Reversion", win_rate: 0.73 },
    worst_drawdown: -0.08,
    equity_curve: [
      { date: "2026-03-01", cumulative_pnl: 0 },
      { date: "2026-03-15", cumulative_pnl: 1240 },
      { date: "2026-04-01", cumulative_pnl: 2180 },
    ],
  },
  trades: [],
  strategy_comparison: {
    strategies: [],
    comparison_data: [],
  },
  market_readiness: {
    status: "green",
    regime: "trending-bull",
    recommended_position_size: 0.75,
  },
};

// ── System risk config — shape matches RiskConfig from lib/api.ts ────────
const systemRiskDefault = {
  kill_switch: false,
  max_daily_loss: -250,
  max_exposure_pct: 80,
  max_concurrent_positions: 3,
  max_trades_per_session: 8,
  cooldown_minutes: 15,
  degraded_data_block: false,
  session_allowlist: ["NY Morning", "NY Afternoon"],
  news_lockout: false,
};

const systemStatusDefault = {
  status: "healthy",
  mode: "paper",
  uptime_seconds: 3600,
  last_heartbeat: new Date().toISOString(),
};

const alpacaAccountDefault = {
  account_number: "TEST-ACCOUNT",
  status: "ACTIVE",
  equity: 100_000,
  buying_power: 50_000,
  cash: 25_000,
  portfolio_value: 100_000,
  pattern_day_trader: false,
  trading_blocked: false,
  account_blocked: false,
};

// ── Handler registry ────────────────────────────────────────────────────
export const handlers = [
  http.get("/api/alerts/summary", () => HttpResponse.json(alertSummaryDefault)),
  http.get("/api/alerts/active-feed", () => HttpResponse.json(alertActiveFeedDefault)),
  http.get("/api/alerts/channels", () => HttpResponse.json(alertChannelsDefault)),
  http.get("/api/alerts/escalation", () => HttpResponse.json(alertEscalationDefault)),
  http.get("/api/alerts/rules", () => HttpResponse.json(alertRulesDefault)),
  http.get("/api/alerts/anomalies", () => HttpResponse.json(alertAnomaliesDefault)),

  http.get("/api/strategies", () => HttpResponse.json(strategiesDefault)),

  http.get("/api/governance/scheduler/status", () =>
    HttpResponse.json(governanceSchedulerStatusDefault)
  ),
  http.get("/api/calibration/scheduler/status", () =>
    HttpResponse.json(governanceSchedulerStatusDefault)
  ),

  http.get("/api/slo/budgets", () => HttpResponse.json(sloBudgetsDefault)),
  http.get("/api/slo/router/status", () => HttpResponse.json(sloRouterStatusDefault)),

  // Proof Dashboard — query string is part of the path; MSW matches on
  // pathname only by default, so the same handler covers `?days=7`,
  // `?days=30`, etc.
  http.get("/api/proof/dashboard", () => HttpResponse.json(proofDashboardDefault)),

  // System config + Alpaca shapes (consumed by settings.tsx and others).
  http.get("/api/system/risk", () => HttpResponse.json(systemRiskDefault)),
  http.get("/api/system/status", () => HttpResponse.json(systemStatusDefault)),
  http.get("/api/alpaca/account", () => HttpResponse.json(alpacaAccountDefault)),

  http.get("/api/healthz", () => HttpResponse.json({ status: "ok" })),
  http.get("/api/readyz", () => HttpResponse.json({ status: "ok" })),

  // SSE endpoint — return an empty text/event-stream body so the fetch
  // fallback (if any) completes. The FakeEventSource shim in setup.ts is
  // what the dashboard actually uses for the push channel.
  http.get("/api/alerts/stream", () =>
    new HttpResponse("", {
      headers: { "content-type": "text/event-stream" },
    })
  ),

  // Permissive catch-all for any other /api/* GET. Returns `{}` or `[]`
  // based on a heuristic: if the path ends with a plural noun we infer a
  // list, otherwise an object. This keeps smoke tests green when a page
  // fans out to endpoints we haven't enumerated.
  http.get("/api/*", ({ request }) => {
    const url = new URL(request.url);
    const tail = url.pathname.split("/").filter(Boolean).pop() ?? "";
    const looksPlural =
      /s$|list$|items$|history$|timeline$|snapshots$|orders$|fills$|positions$|venues$|rules$|feeds$|sessions$/.test(
        tail
      );
    return HttpResponse.json(looksPlural ? [] : {});
  }),

  // Permissive catch-all for POST / PUT / DELETE — return 200 with an
  // empty ack so mutation tests don't throw on unmocked endpoints.
  http.post("/api/*", () => HttpResponse.json({ ok: true })),
  http.put("/api/*", () => HttpResponse.json({ ok: true })),
  http.delete("/api/*", () => HttpResponse.json({ ok: true })),
];
