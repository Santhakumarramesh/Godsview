#!/usr/bin/env node
/**
 * GodsView MCP Server v1.3 — read-only inspection layer.
 *
 * Hard constraints (do NOT relax without an explicit Milestone bump):
 *  - Read-only: every tool issues HTTP GET only.
 *  - Paper-only: this server cannot place orders, modify positions,
 *    flip the kill switch, or write any state.
 *  - No fake data: when an upstream endpoint is unreachable or returns
 *    a non-2xx, the tool returns a structured `not_connected` payload
 *    (status, reason, base_url, path) — never a fabricated success.
 *  - No browser automation, no chart control, no order book scraping.
 *
 * Sixteen tools:
 *   1. get_brain_state                  → GET /api/brain-state
 *   2. get_active_signals               → GET /api/signals
 *   3. explain_latest_pipeline_decision → /api/brain-state, projects pipeline
 *   4. get_risk_status                  → /api/brain-state, projects risk
 *   5. get_proof_status                 → /api/brain-state, projects proof
 *
 *   Milestone 4 additions (v1.1):
 *   6. get_phase6_health           → GET /api/health/phase6 + /api/ready/phase6
 *   7. get_recent_rejected_signals → /api/signals/rejected if available, else
 *                                    /api/brain-state.signals.rejected
 *   8. get_paper_positions         → GET /api/alpaca/positions (real broker —
 *                                    NOT /api/positions which returns mocked data)
 *   9. get_scanner_status          → /api/brain-state.scanner (status + history)
 *  10. get_m2_pipeline_status      → /api/brain-state.pipeline (compact)
 *  11. get_system_verdict          → /api/brain-state.verdict + supporting fields
 *
 *   Milestone 5a additions (v1.2):
 *  12. get_strategy_history        → GET /api/strategy-registry/snapshot +
 *                                    GET /api/strategy-registry/list (parallel)
 *  13. get_watchlist               → GET /api/watchlist
 *  14. get_proof_trades_paginated  → GET /api/proof/trades?limit&status
 *                                    (limit 1–500, status executed|rejected)
 *  15. get_phase6_data_health      → GET /api/data-quality/health +
 *                                    GET /api/data-integrity/health (parallel)
 *
 *   Milestone 5d-β addition (v1.3):
 *  16. get_macro_risk              → GET /api/macro-risk
 *                                    (FRED snapshot + macro_engine events +
 *                                     news_window + news_feed; per-section
 *                                     source_quality labels; never fabricated)
 *
 * Configuration:
 *   GODSVIEW_BASE_URL   Base URL of the GodsView API server.
 *                       Defaults to http://localhost:3000.
 *                       Examples: http://54.162.228.136, https://api.godsview.dev
 *   GODSVIEW_HTTP_TIMEOUT_MS  Per-request timeout. Default 6000ms.
 *
 * Diagnostics: per-call counters and outcome logged to stderr only
 * (stdout is reserved for JSON-RPC). One line per tool call:
 *   [godsview-mcp] tool=<name> outcome=<ok|not_connected|error> dt_ms=<n>
 *                  calls=<n> ok=<n> nc=<n> err=<n>
 *
 * Transport: stdio (JSON-RPC over stdin/stdout) via the official
 * @modelcontextprotocol/sdk StdioServerTransport.
 */

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

/* Config */
const RAW_BASE_URL = process.env.GODSVIEW_BASE_URL ?? "http://localhost:3000";
const BASE_URL = RAW_BASE_URL.replace(/\/+$/, "");
const HTTP_TIMEOUT_MS = Number(process.env.GODSVIEW_HTTP_TIMEOUT_MS ?? "6000");
const SERVER_NAME = "godsview-mcp";
const SERVER_VERSION = "1.3.0";

/* Types */
type FetchOk<T> = { ok: true; status: number; data: T };
type FetchErr = { ok: false; status: number; reason: string; body?: string };
type FetchResult<T> = FetchOk<T> | FetchErr;

type ToolOutcome = "ok" | "not_connected" | "error";
type CounterEntry = { calls: number; ok: number; not_connected: number; error: number };
const counters: Record<string, CounterEntry> = {};
function incCounter(name: string, outcome: ToolOutcome): CounterEntry {
  let c = counters[name];
  if (!c) {
    c = { calls: 0, ok: 0, not_connected: 0, error: 0 };
    counters[name] = c;
  }
  c.calls += 1;
  c[outcome] += 1;
  return c;
}
function classifyOutcome(data: unknown): ToolOutcome {
  if (data && typeof data === "object" && (data as { status?: unknown }).status === "not_connected") {
    return "not_connected";
  }
  return "ok";
}

function notConnected(opts: {
  tool: string;
  path: string;
  status: number;
  reason: string;
  body?: string;
}): Record<string, unknown> {
  return {
    status: "not_connected",
    tool: opts.tool,
    base_url: BASE_URL,
    path: opts.path,
    upstream_status: opts.status,
    reason: opts.reason,
    upstream_body_preview: opts.body,
    note: "This MCP server is read-only. The upstream endpoint was unreachable or returned a non-2xx response. No data was fabricated.",
  };
}

/* HTTP client (GET only, never logs secrets) */
async function safeGet<T = unknown>(path: string): Promise<FetchResult<T>> {
  const url = `${BASE_URL}${path.startsWith("/") ? path : `/${path}`}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), HTTP_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: { Accept: "application/json" },
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) {
      let preview: string | undefined;
      try { const t = await res.text(); preview = t.slice(0, 400); } catch { /* ignore */ }
      return { ok: false, status: res.status, reason: `Upstream HTTP ${res.status}`, body: preview };
    }
    const contentType = res.headers.get("content-type") ?? "";
    if (!contentType.toLowerCase().includes("application/json")) {
      let preview: string | undefined;
      try { const t = await res.text(); preview = t.slice(0, 400); } catch { /* ignore */ }
      return {
        ok: false,
        status: res.status,
        reason: `Upstream did not return JSON (content-type: ${contentType || "unknown"})`,
        body: preview,
      };
    }
    const data = (await res.json()) as T;
    return { ok: true, status: res.status, data };
  } catch (err) {
    clearTimeout(timer);
    const reason =
      err instanceof Error
        ? err.name === "AbortError"
          ? `Timeout after ${HTTP_TIMEOUT_MS}ms`
          : err.message
        : String(err);
    return { ok: false, status: 0, reason };
  }
}

/* Tool definitions */
const TOOLS = [
  {
    name: "get_brain_state",
    description:
      "Read-only. Returns the full GodsView Brain Console aggregator payload (mode, account, scanner, proof, signals, risk, macro, mcp, pipeline). Calls GET /api/brain-state. Returns not_connected envelope on upstream failure. Never places orders.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_active_signals",
    description:
      "Read-only. Returns accepted/active trading signals via GET /api/signals. Returns not_connected if upstream is down. Never places orders.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "explain_latest_pipeline_decision",
    description:
      "Read-only. Projects the Milestone 2 pipeline section from /api/brain-state with strategy meta, totals (attempted, evaluated, insufficient_bars, fetch_errors, accepted, no_trade, error, executed, execution_blocked), last_decision, last_accepted, last_no_trade, last_error, last_insufficient_bars_reason, by_symbol, not_connected_layers.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_risk_status",
    description:
      "Read-only. Projects the risk section from /api/brain-state — risk summary, lockouts, drawdown, daily loss state, active risk gates. Never modifies risk state.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_proof_status",
    description:
      "Read-only. Projects the proof section from /api/brain-state — paper-trade proof metrics, equity, integrity, reconciliation. Never writes to proof.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_phase6_health",
    description:
      "Read-only. Calls GET /api/health/phase6 and GET /api/ready/phase6 in parallel. Returns service uptime, DB and Redis status with latency_ms, last reconciler/data-health run timestamps, readiness flag, blocking reasons, env_missing list. Honest not_connected envelope on upstream failure.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_recent_rejected_signals",
    description:
      "Read-only. Returns recent rejected/no-trade signals. First tries the dedicated GET /api/signals/rejected; if that endpoint is broken or unavailable, falls back to the rejected-signals projection inside /api/brain-state.signals.rejected. Empty when no rejections exist (honest empty array, never fabricated). Never places orders.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_paper_positions",
    description:
      "Read-only. Returns OPEN paper-broker positions only via GET /api/alpaca/positions (real Alpaca paper account — NOT the legacy /api/positions endpoint which returns hardcoded mock data). Returns an empty array honestly when there are no open positions. Never places, modifies, or closes any position.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_scanner_status",
    description:
      "Read-only. Projects the scanner block from /api/brain-state — running flag, scan count, interval/cooldown ms, watchlist size, and history of recent scans (started_at, completed_at, symbols_scanned, signals_found, alerts_emitted, blocked, duration_ms).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_m2_pipeline_status",
    description:
      "Read-only. Compact projection of the Milestone 2 pipeline section in /api/brain-state — strategy_name, strategy_version, last_evaluation_at, last_attempt_at, last_symbol, last_timeframe, last_error, last_insufficient_bars_reason, totals, latest_reason, not_connected_layers. Slimmer than explain_latest_pipeline_decision.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_system_verdict",
    description:
      "Read-only. Returns the server-generated verdict string from /api/brain-state.verdict plus supporting fields (mode, generated_at, broker buying_power/equity, scanner running, last decision reason, kill_switch state, mcp_status). One-line system summary.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_strategy_history",
    description:
      "Read-only (Milestone 5a). Returns the strategy registry snapshot and full strategy list in parallel via GET /api/strategy-registry/snapshot and GET /api/strategy-registry/list. Snapshot includes totalStrategies, byState counts, recentPromotions, recentRetirements, topPerformers. List returns all registered strategies. Honest empty arrays when no strategies are registered. Never modifies the registry.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_watchlist",
    description:
      "Read-only (Milestone 5a). Returns the active watchlist via GET /api/watchlist — symbol, label, assetClass (crypto|forex|equity|commodity), enabled flag, addedAt, lastScannedAt, signalCount, note. Never adds, removes, or modifies watchlist entries.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_proof_trades_paginated",
    description:
      "Read-only (Milestone 5a). Returns paginated paper-trade proof entries via GET /api/proof/trades. Accepts `limit` (1–500, default 50) and `status` (executed | rejected, default executed). For executed: returns count, open_count, closed_count, trades. For rejected: returns count, trades (each with rejection reason). Never places, modifies, or closes any trade.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Max trades to return. Default 50. Capped at 500.",
          minimum: 1,
          maximum: 500,
        },
        status: {
          type: "string",
          enum: ["executed", "rejected"],
          description: "Filter by trade status. Default 'executed'.",
        },
      },
      additionalProperties: false,
    },
  },
  {
    name: "get_phase6_data_health",
    description:
      "Read-only (Milestone 5a). Calls GET /api/data-quality/health and GET /api/data-integrity/health in parallel. Returns feed health (tracked / fresh / stale / dead counts), recent stale/dead alerts, rejection rate, buffer utilization, stale symbol count, and module uptime. Complementary to get_phase6_health, which covers DB/Redis/readiness. Honest not_connected envelope on upstream failure.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "get_macro_risk",
    description:
      "Read-only (Milestone 5d-β). Returns the GodsView macro/news aggregate via GET /api/macro-risk: synthesized macro_risk level (anchored on REAL FRED label), full FRED snapshot when available (CPI, Fed Funds, treasuries, VIX, GDP, unemployment, claims) with explicit source-quality status, macro_engine events section (high_impact_upcoming + next_event; honest not_connected when no event provider is wired), news_window state (active flag + affected_symbols), news_feed status (currently not_connected with explicit reason — no news provider configured), and last_updated timestamp. Every section carries its own source_quality label; never fabricates values. The endpoint itself returns ok | partial | not_connected based on which layers answered.",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
] as const;

/* Tool implementations — Milestone 3 (v1.0) */
async function toolGetBrainState(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, unknown>>(path);
  if (!r.ok) return notConnected({ tool: "get_brain_state", path, status: r.status, reason: r.reason, body: r.body });
  return r.data;
}

async function toolGetActiveSignals(): Promise<unknown> {
  const path = "/api/signals";
  const r = await safeGet<unknown>(path);
  if (!r.ok) return notConnected({ tool: "get_active_signals", path, status: r.status, reason: r.reason, body: r.body });
  return r.data;
}

async function toolExplainLatestPipelineDecision(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "explain_latest_pipeline_decision", path, status: r.status, reason: r.reason, body: r.body });
  const pipeline = r.data?.pipeline;
  if (!pipeline) {
    return {
      status: "not_connected",
      tool: "explain_latest_pipeline_decision",
      base_url: BASE_URL,
      path,
      reason: "Upstream /api/brain-state did not include a `pipeline` section. The Milestone 2 pipeline may not be deployed.",
    };
  }
  return { status: "ok", tool: "explain_latest_pipeline_decision", generated_at: r.data?.generated_at, mode: r.data?.mode, pipeline };
}

async function toolGetRiskStatus(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_risk_status", path, status: r.status, reason: r.reason, body: r.body });
  const risk = r.data?.risk;
  if (!risk) {
    return { status: "not_connected", tool: "get_risk_status", base_url: BASE_URL, path, reason: "Upstream /api/brain-state did not include a `risk` section." };
  }
  return { status: "ok", tool: "get_risk_status", generated_at: r.data?.generated_at, mode: r.data?.mode, risk };
}

async function toolGetProofStatus(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_proof_status", path, status: r.status, reason: r.reason, body: r.body });
  const proof = r.data?.proof;
  if (!proof) {
    return { status: "not_connected", tool: "get_proof_status", base_url: BASE_URL, path, reason: "Upstream /api/brain-state did not include a `proof` section." };
  }
  return { status: "ok", tool: "get_proof_status", generated_at: r.data?.generated_at, mode: r.data?.mode, proof };
}

/* Tool implementations — Milestone 4 (v1.1) */
async function toolGetPhase6Health(): Promise<unknown> {
  const [healthR, readyR] = await Promise.all([
    safeGet<Record<string, any>>("/api/health/phase6"),
    safeGet<Record<string, any>>("/api/ready/phase6"),
  ]);

  const healthSection = healthR.ok
    ? { status: "ok" as const, value: healthR.data }
    : { status: "not_connected" as const, value: null, path: "/api/health/phase6", upstream_status: healthR.status, reason: healthR.reason };

  const readySection = readyR.ok
    ? { status: "ok" as const, value: readyR.data }
    : { status: "not_connected" as const, value: null, path: "/api/ready/phase6", upstream_status: readyR.status, reason: readyR.reason };

  if (!healthR.ok && !readyR.ok) {
    return {
      status: "not_connected",
      tool: "get_phase6_health",
      base_url: BASE_URL,
      reason: `Both /api/health/phase6 and /api/ready/phase6 unreachable. health=${healthR.reason}; ready=${readyR.reason}`,
    };
  }
  return { status: "ok", tool: "get_phase6_health", base_url: BASE_URL, health: healthSection, ready: readySection };
}

async function toolGetRecentRejectedSignals(): Promise<unknown> {
  const direct = await safeGet<unknown>("/api/signals/rejected");
  if (direct.ok) {
    return { status: "ok", tool: "get_recent_rejected_signals", source: "/api/signals/rejected", data: direct.data };
  }
  const bs = await safeGet<Record<string, any>>("/api/brain-state");
  if (!bs.ok) {
    return notConnected({
      tool: "get_recent_rejected_signals",
      path: "/api/brain-state (fallback after /api/signals/rejected failed)",
      status: bs.status,
      reason: `Direct /api/signals/rejected failed (${direct.status}: ${direct.reason}); fallback also failed: ${bs.reason}`,
      body: bs.body,
    });
  }
  const rejected = bs.data?.signals?.rejected;
  if (!rejected) {
    return {
      status: "not_connected",
      tool: "get_recent_rejected_signals",
      base_url: BASE_URL,
      reason: "Direct /api/signals/rejected returned a non-2xx, and /api/brain-state has no signals.rejected projection.",
      direct_endpoint_status: direct.status,
      direct_endpoint_reason: direct.reason,
    };
  }
  return {
    status: "ok",
    tool: "get_recent_rejected_signals",
    source: "/api/brain-state.signals.rejected",
    direct_endpoint_status: direct.status,
    direct_endpoint_reason: direct.reason,
    generated_at: bs.data?.generated_at,
    rejected,
  };
}

async function toolGetPaperPositions(): Promise<unknown> {
  const path = "/api/alpaca/positions";
  const r = await safeGet<unknown>(path);
  if (!r.ok) return notConnected({ tool: "get_paper_positions", path, status: r.status, reason: r.reason, body: r.body });
  return {
    status: "ok",
    tool: "get_paper_positions",
    source: path,
    note: "Open paper-broker positions only. Empty array means no open positions, not a missing endpoint.",
    positions: r.data,
    count: Array.isArray(r.data) ? r.data.length : undefined,
  };
}

async function toolGetScannerStatus(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_scanner_status", path, status: r.status, reason: r.reason, body: r.body });
  const scanner = r.data?.scanner;
  if (!scanner) {
    return { status: "not_connected", tool: "get_scanner_status", base_url: BASE_URL, path, reason: "Upstream /api/brain-state did not include a `scanner` section." };
  }
  return { status: "ok", tool: "get_scanner_status", generated_at: r.data?.generated_at, scanner };
}

async function toolGetM2PipelineStatus(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_m2_pipeline_status", path, status: r.status, reason: r.reason, body: r.body });
  const pipeline = r.data?.pipeline;
  if (!pipeline) {
    return {
      status: "not_connected",
      tool: "get_m2_pipeline_status",
      base_url: BASE_URL,
      path,
      reason: "Upstream /api/brain-state did not include a `pipeline` section. The Milestone 2 pipeline may not be deployed.",
    };
  }
  const v = pipeline.value ?? {};
  return {
    status: "ok",
    tool: "get_m2_pipeline_status",
    generated_at: r.data?.generated_at,
    pipeline_status: pipeline.status,
    summary: {
      strategy_name: v.strategy_name ?? null,
      strategy_version: v.strategy_version ?? null,
      last_evaluation_at: v.last_evaluation_at ?? null,
      last_attempt_at: v.last_attempt_at ?? null,
      last_symbol: v.last_symbol ?? null,
      last_timeframe: v.last_timeframe ?? null,
      last_error: v.last_error ?? null,
      last_insufficient_bars_reason: v.last_insufficient_bars_reason ?? null,
      latest_reason: v.last_decision?.reason ?? v.last_no_trade?.reason ?? null,
      totals: v.totals ?? null,
      not_connected_layers: v.not_connected_layers ?? [],
    },
  };
}

async function toolGetSystemVerdict(): Promise<unknown> {
  const path = "/api/brain-state";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_system_verdict", path, status: r.status, reason: r.reason, body: r.body });
  const verdict = r.data?.verdict;
  if (typeof verdict !== "string" || verdict.length === 0) {
    return {
      status: "not_connected",
      tool: "get_system_verdict",
      base_url: BASE_URL,
      path,
      reason: "Upstream /api/brain-state did not include a non-empty `verdict` string.",
    };
  }
  return {
    status: "ok",
    tool: "get_system_verdict",
    generated_at: r.data?.generated_at,
    verdict,
    mode: r.data?.mode ?? null,
    broker: {
      equity: r.data?.account?.value?.equity ?? null,
      buying_power: r.data?.account?.value?.buying_power ?? null,
      currency: r.data?.account?.value?.currency ?? null,
      is_paper: r.data?.account?.value?.is_paper ?? null,
    },
    scanner_running: r.data?.scanner?.status?.value?.running ?? null,
    pipeline_latest_reason:
      r.data?.pipeline?.value?.last_decision?.reason ??
      r.data?.pipeline?.value?.last_no_trade?.reason ??
      null,
    kill_switch_active: r.data?.mode?.kill_switch_active ?? null,
    mcp_status: r.data?.mcp?.status ?? null,
  };
}

/* Tool implementations — Milestone 5a (v1.2) */
async function toolGetStrategyHistory(): Promise<unknown> {
  const [snapR, listR] = await Promise.all([
    safeGet<Record<string, any>>("/api/strategy-registry/snapshot"),
    safeGet<Record<string, any>>("/api/strategy-registry/list"),
  ]);

  const snapshotSection = snapR.ok
    ? { status: "ok" as const, value: snapR.data }
    : {
        status: "not_connected" as const,
        value: null,
        path: "/api/strategy-registry/snapshot",
        upstream_status: snapR.status,
        reason: snapR.reason,
      };

  const listSection = listR.ok
    ? { status: "ok" as const, value: listR.data }
    : {
        status: "not_connected" as const,
        value: null,
        path: "/api/strategy-registry/list",
        upstream_status: listR.status,
        reason: listR.reason,
      };

  if (!snapR.ok && !listR.ok) {
    return {
      status: "not_connected",
      tool: "get_strategy_history",
      base_url: BASE_URL,
      reason: `Both /api/strategy-registry/snapshot and /api/strategy-registry/list unreachable. snapshot=${snapR.reason}; list=${listR.reason}`,
    };
  }
  return {
    status: "ok",
    tool: "get_strategy_history",
    base_url: BASE_URL,
    snapshot: snapshotSection,
    list: listSection,
  };
}

async function toolGetWatchlist(): Promise<unknown> {
  const path = "/api/watchlist";
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_watchlist", path, status: r.status, reason: r.reason, body: r.body });
  const wl = r.data?.watchlist;
  const wlArray = Array.isArray(wl) ? wl : [];
  const count = typeof r.data?.count === "number" ? r.data.count : wlArray.length;
  return {
    status: "ok",
    tool: "get_watchlist",
    source: path,
    note: "Read-only watchlist snapshot. POST/DELETE are not exposed via MCP.",
    count,
    watchlist: wlArray,
  };
}

async function toolGetProofTradesPaginated(args: unknown): Promise<unknown> {
  const a = (args && typeof args === "object" ? args : {}) as Record<string, unknown>;

  const rawLimit = a.limit;
  let limit: number;
  if (typeof rawLimit === "number" && Number.isFinite(rawLimit)) {
    limit = Math.floor(rawLimit);
  } else if (typeof rawLimit === "string" && rawLimit.trim() !== "" && Number.isFinite(Number(rawLimit))) {
    limit = Math.floor(Number(rawLimit));
  } else {
    limit = 50;
  }
  if (limit < 1) limit = 1;
  if (limit > 500) limit = 500;

  const rawStatus = typeof a.status === "string" ? a.status.toLowerCase() : "";
  const status: "executed" | "rejected" = rawStatus === "rejected" ? "rejected" : "executed";

  const path = `/api/proof/trades?limit=${limit}&status=${status}`;
  const r = await safeGet<Record<string, any>>(path);
  if (!r.ok) return notConnected({ tool: "get_proof_trades_paginated", path, status: r.status, reason: r.reason, body: r.body });
  return {
    status: "ok",
    tool: "get_proof_trades_paginated",
    source: path,
    requested: { limit, status },
    data: r.data,
  };
}

async function toolGetPhase6DataHealth(): Promise<unknown> {
  const [qR, iR] = await Promise.all([
    safeGet<Record<string, any>>("/api/data-quality/health"),
    safeGet<Record<string, any>>("/api/data-integrity/health"),
  ]);

  const dataQualitySection = qR.ok
    ? { status: "ok" as const, value: qR.data }
    : {
        status: "not_connected" as const,
        value: null,
        path: "/api/data-quality/health",
        upstream_status: qR.status,
        reason: qR.reason,
      };

  const dataIntegritySection = iR.ok
    ? { status: "ok" as const, value: iR.data }
    : {
        status: "not_connected" as const,
        value: null,
        path: "/api/data-integrity/health",
        upstream_status: iR.status,
        reason: iR.reason,
      };

  if (!qR.ok && !iR.ok) {
    return {
      status: "not_connected",
      tool: "get_phase6_data_health",
      base_url: BASE_URL,
      reason: `Both /api/data-quality/health and /api/data-integrity/health unreachable. quality=${qR.reason}; integrity=${iR.reason}`,
    };
  }
  return {
    status: "ok",
    tool: "get_phase6_data_health",
    base_url: BASE_URL,
    data_quality: dataQualitySection,
    data_integrity: dataIntegritySection,
  };
}

/* Tool implementation — Milestone 5d-β (v1.3) */
async function toolGetMacroRisk(): Promise<unknown> {
  const path = "/api/macro-risk";
  const r = await safeGet<Record<string, unknown>>(path);
  if (!r.ok) {
    return notConnected({ tool: "get_macro_risk", path, status: r.status, reason: r.reason, body: r.body });
  }
  // Pass through the aggregate shape verbatim — it already carries
  // per-section source_quality labels and overall status.
  // Wrap in our standard MCP envelope so callers get a consistent shape.
  const data = r.data as Record<string, any>;
  return {
    status: "ok",
    tool: "get_macro_risk",
    source: path,
    aggregate_status: data?.status ?? null,
    generated_at: data?.generated_at ?? null,
    last_updated: data?.last_updated ?? null,
    macro_risk: data?.macro_risk ?? null,
    fred: data?.fred ?? null,
    events: data?.events ?? null,
    news_window: data?.news_window ?? null,
    news_feed: data?.news_feed ?? null,
  };
}

/* Dispatch */
async function dispatchTool(name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case "get_brain_state": return toolGetBrainState();
    case "get_active_signals": return toolGetActiveSignals();
    case "explain_latest_pipeline_decision": return toolExplainLatestPipelineDecision();
    case "get_risk_status": return toolGetRiskStatus();
    case "get_proof_status": return toolGetProofStatus();
    case "get_phase6_health": return toolGetPhase6Health();
    case "get_recent_rejected_signals": return toolGetRecentRejectedSignals();
    case "get_paper_positions": return toolGetPaperPositions();
    case "get_scanner_status": return toolGetScannerStatus();
    case "get_m2_pipeline_status": return toolGetM2PipelineStatus();
    case "get_system_verdict": return toolGetSystemVerdict();
    case "get_strategy_history": return toolGetStrategyHistory();
    case "get_watchlist": return toolGetWatchlist();
    case "get_proof_trades_paginated": return toolGetProofTradesPaginated(args);
    case "get_phase6_data_health": return toolGetPhase6DataHealth();
    case "get_macro_risk": return toolGetMacroRisk();
    default: throw new Error(`Unknown tool: ${name}`);
  }
}

/* Server bootstrap */
async function main() {
  const server = new Server(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: { tools: {} } },
  );

  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const name = req.params.name;
    const args = req.params.arguments;
    const t0 = Date.now();
    try {
      const data = await dispatchTool(name, args);
      const dt = Date.now() - t0;
      const outcome = classifyOutcome(data);
      const c = incCounter(name, outcome);
      process.stderr.write(
        `[${SERVER_NAME}] tool=${name} outcome=${outcome} dt_ms=${dt} calls=${c.calls} ok=${c.ok} nc=${c.not_connected} err=${c.error}\n`,
      );
      return { content: [{ type: "text", text: JSON.stringify(data, null, 2) }] };
    } catch (err) {
      const dt = Date.now() - t0;
      const reason = err instanceof Error ? err.message : String(err);
      const c = incCounter(name, "error");
      process.stderr.write(
        `[${SERVER_NAME}] tool=${name} outcome=error dt_ms=${dt} reason=${reason} calls=${c.calls} ok=${c.ok} nc=${c.not_connected} err=${c.error}\n`,
      );
      return {
        content: [{ type: "text", text: JSON.stringify({ status: "error", tool: name, base_url: BASE_URL, reason }, null, 2) }],
        isError: true,
      };
    }
  });

  const transport = new StdioServerTransport();
  await server.connect(transport);
  process.stderr.write(`[${SERVER_NAME}@${SERVER_VERSION}] connected. base_url=${BASE_URL} tools=${TOOLS.length}\n`);
}

main().catch((err) => {
  const msg = err instanceof Error ? err.stack ?? err.message : String(err);
  process.stderr.write(`[${SERVER_NAME}] fatal: ${msg}\n`);
  process.exit(1);
});
