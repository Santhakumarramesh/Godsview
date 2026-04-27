/**
 * Route Aliases — maps dashboard-expected paths to actual handler endpoints.
 *
 * The GodsView dashboard evolved independently from the API route structure,
 * so some pages fetch paths that differ from where the handlers are registered.
 * This file provides lightweight forwards so every dashboard fetch lands on a
 * real handler instead of hitting the SPA fallback 404.
 *
 * Pattern: each alias re-invokes the correct route handler by importing
 * the same business logic, keeping responses identical.
 */
import { Router, type Request, type Response } from "express";
import { portfolioState } from "./portfolio";
import { tradingSafety } from "../lib/trading_safety";
import { logger } from "../lib/logger";
import { getConsciousnessSnapshot, getLatestBrainSnapshot } from "../lib/brain_bridge";
import { getLatestTrade, getLatestBar } from "../lib/alpaca";

const router = Router();

// ── Portfolio aliases ─────────────────────────────────────────────────────
// Dashboard expects: /api/portfolio/summary, /api/portfolio/positions, /api/portfolio/allocation
// Actual handlers are at: /api/portfolio/current, /api/portfolio/current, /api/portfolio/compute

router.get("/api/portfolio/summary", (_req: Request, res: Response) => {
  try {
    const totalValue = portfolioState.positions.reduce(
      (sum, p) => sum + p.quantity * p.currentPrice, 0
    );
    const totalExposure = portfolioState.positions.reduce(
      (sum, p) => sum + Math.abs(p.quantity * p.currentPrice), 0
    );
    const pnl = totalValue - portfolioState.positions.reduce(
      (sum, p) => sum + p.quantity * p.entryPrice, 0
    );
    res.json({
      positions_count: portfolioState.positions.length,
      total_exposure: totalExposure,
      total_value: totalValue,
      capital: portfolioState.capital,
      pnl,
      pnl_pct: portfolioState.capital > 0 ? (pnl / portfolioState.capital) * 100 : 0,
      timestamp: portfolioState.timestamp,
      positions: portfolioState.positions,
    });
  } catch (error) {
    res.status(503).json({ error: "Portfolio data unavailable", source: "alias" });
  }
});

router.get("/api/portfolio/positions", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    positions: portfolioState.positions,
    count: portfolioState.positions.length,
    timestamp: portfolioState.timestamp,
  });
});

router.get("/api/portfolio/allocation", (_req: Request, res: Response) => {
  const total = portfolioState.capital;
  const invested = portfolioState.positions.reduce(
    (s, p) => s + Math.abs(p.quantity * p.entryPrice), 0
  );
  res.json({
    ok: true,
    total_capital: total,
    invested,
    available: total - invested,
    utilization_pct: total > 0 ? (invested / total) * 100 : 0,
    positions: portfolioState.positions.map(p => ({
      symbol: p.symbol,
      allocation_pct: total > 0 ? (Math.abs(p.quantity * p.currentPrice) / total) * 100 : 0,
      sector: p.sector,
    })),
  });
});

// ── Journal alias ─────────────────────────────────────────────────────────
// Dashboard expects: /api/journal/trades
// Actual: /api/journal/ (GET /) — redirect won't work because /:id catches "trades"
import { listJournalEntries } from "../lib/trade_journal";

router.get("/api/journal/trades", (req: Request, res: Response) => {
  try {
    const limit = req.query.limit ? parseInt(String(req.query.limit), 10) : 50;
    const offset = req.query.offset ? parseInt(String(req.query.offset), 10) : 0;
    const symbol = req.query.symbol ? String(req.query.symbol).toUpperCase() : undefined;
    const entries = listJournalEntries({ symbol, limit, offset });
    res.json({ entries, count: entries.length });
  } catch {
    res.status(503).json({ error: "Failed to list journal entries" });
  }
});

// ── Alpaca status alias ───────────────────────────────────────────────────
// Dashboard expects: /api/execution/alpaca/status
// Actual: /api/alpaca/account (under alpaca router mounted without prefix)
router.get("/api/execution/alpaca/status", async (_req: Request, res: Response) => {
  try {
    const key = process.env.ALPACA_API_KEY;
    const secret = process.env.ALPACA_SECRET_KEY;
    const base = process.env.ALPACA_BASE_URL || "https://paper-api.alpaca.markets";
    if (!key || !secret) {
      res.json({ connected: false, error: "Alpaca keys not configured" });
      return;
    }
    const resp = await fetch(`${base}/v2/account`, {
      headers: { "APCA-API-KEY-ID": key, "APCA-API-SECRET-KEY": secret },
    });
    if (!resp.ok) {
      res.json({ connected: false, error: `Alpaca returned ${resp.status}` });
      return;
    }
    const acct = await resp.json() as Record<string, unknown>;
    res.json({
      connected: true,
      account_id: acct.id,
      status: acct.status,
      equity: acct.equity,
      buying_power: acct.buying_power,
      paper: base.includes("paper"),
    });
  } catch (err) {
    res.json({ connected: false, error: err instanceof Error ? err.message : "Unknown" });
  }
});

// ── Autonomous status aliases ──────────────────────────────────────────────
// Dashboard expects: /api/autonomous/status and /api/brain/autonomous/status
// Actual: /api/autonomous/state
router.get("/api/autonomous/status", (_req: Request, res: Response) => {
  res.redirect(307, "/api/autonomous/state");
});

router.get("/api/brain/autonomous/status", (_req: Request, res: Response) => {
  res.redirect(307, "/api/autonomous/state");
});

// ── Strategy evolution/governor aliases ─────────────────────────────────────
// Dashboard expects: /api/strategy-evolution/status, /api/strategy-governor/status
// Actual: mounted without prefix, paths are /brain/strategy/evolution/status etc.
router.get("/api/strategy-evolution/status", (_req: Request, res: Response) => {
  res.redirect(307, "/api/brain/strategy/evolution/status");
});

router.get("/api/strategy-governor/status", (_req: Request, res: Response) => {
  res.redirect(307, "/api/brain/strategy/governor/status");
});

// ── Memory aliases ─────────────────────────────────────────────────────────
// Dashboard expects: /api/memory/cases, /api/memory/store
// Actual: /api/memory/failures (cases), /api/memory/stats (store)
router.get("/api/memory/cases", (_req: Request, res: Response) => {
  res.redirect(307, "/api/memory/failures");
});

router.get("/api/memory/store", (_req: Request, res: Response) => {
  res.redirect(307, "/api/memory/stats");
});

// ── TradingView status alias ───────────────────────────────────────────────
// Dashboard expects: /api/tradingview/status
// Actual: /api/tradingview/health
router.get("/api/tradingview/status", (_req: Request, res: Response) => {
  res.redirect(307, "/api/tradingview/health");
});

// ── Sentiment alias ────────────────────────────────────────────────────────
// Dashboard expects: /api/sentiment/overview
// Actual: /api/sentiment/snapshot
router.get("/api/sentiment/overview", (_req: Request, res: Response) => {
  res.redirect(307, "/api/sentiment/snapshot");
});

// ── Truth audit alias ──────────────────────────────────────────────────────
// Dashboard expects: /api/truth-audit/run
// Actual: /api/truth-audit/readiness
router.get("/api/truth-audit/run", (_req: Request, res: Response) => {
  res.redirect(307, "/api/truth-audit/readiness");
});

// ── Bloomberg alias ────────────────────────────────────────────────────────
// Dashboard expects: /api/bloomberg/overview
// Actual: /api/bloomberg/market/snapshot
router.get("/api/bloomberg/overview", (_req: Request, res: Response) => {
  res.redirect(307, "/api/bloomberg/market/snapshot");
});

// ── Governance audit-log alias ─────────────────────────────────────────────
// Dashboard expects: /api/governance/audit-log
// Actual: /api/governance/audit
router.get("/api/governance/audit-log", (_req: Request, res: Response) => {
  res.redirect(307, "/api/governance/audit");
});

// ── Lab experiments alias ──────────────────────────────────────────────────
// Dashboard expects: /api/lab/experiments
// Actual: /api/lab/health (no experiments list endpoint, return health)
router.get("/api/lab/experiments", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    experiments: [],
    total: 0,
    message: "No active experiments. Use POST /api/lab/parse to start strategy analysis.",
  });
});

// ── Quant status alias ─────────────────────────────────────────────────────
// Dashboard expects: /api/quant/status
// Quant router only has POST endpoints — return status summary
router.get("/api/quant/status", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    engine: "quant_super_intelligence",
    capabilities: ["analyze", "prescreen", "critique", "improve", "rank", "hypothesis", "reject", "compare"],
    status: "ready",
    message: "Quant engine ready. Use POST endpoints for analysis.",
  });
});

// ── Risk policies alias ────────────────────────────────────────────────────
// Dashboard expects: /api/risk/policies
// Actual: safety status contains the limits
router.get("/api/risk/policies", (_req: Request, res: Response) => {
  const status = tradingSafety.getStatus();
  res.json({
    ok: true,
    policies: {
      maxDailyLoss: status.limits.maxDailyLoss,
      maxDailyTrades: status.limits.maxDailyTrades,
      maxPositionSize: status.limits.maxPositionSize,
      maxOpenPositions: status.limits.maxOpenPositions,
      maxConsecutiveLosses: status.limits.maxConsecutiveLosses,
      cooldownMinutes: status.limits.cooldownMinutes,
      paperOnly: status.paperOnly,
      liveAllowed: status.liveAllowed,
    },
  });
});

// ── Risk correlation alias ─────────────────────────────────────────────────
// Dashboard expects: /api/risk/correlation
// Actual: /api/correlation/matrix
router.get("/api/risk/correlation", (_req: Request, res: Response) => {
  res.redirect(307, "/api/correlation/matrix");
});

// ── Strategies list alias ──────────────────────────────────────────────────
// Dashboard expects: /api/strategies
router.get("/api/strategies", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    strategies: [
      { id: "ob_retest", name: "Order Block Retest", status: "active" },
      { id: "sweep_reclaim", name: "Liquidity Sweep Reclaim", status: "active" },
      { id: "breakout_failure", name: "Breakout Failure", status: "active" },
      { id: "continuation_pullback", name: "Continuation Pullback", status: "active" },
      { id: "fvg_fill", name: "Fair Value Gap Fill", status: "active" },
      { id: "vwap_reclaim", name: "VWAP Reclaim", status: "active" },
    ],
  });
});

// ── Billing subscription alias ─────────────────────────────────────────────
// Dashboard expects: /api/billing/subscription
// Actual: /api/monetization/billing
router.get("/api/billing/subscription", (_req: Request, res: Response) => {
  res.redirect(307, "/api/monetization/billing");
});

// ── Data quality scores alias ──────────────────────────────────────────────
// Dashboard expects: /api/data-quality/scores
// Actual: /api/data-quality/health
router.get("/api/data-quality/scores", (_req: Request, res: Response) => {
  res.redirect(307, "/api/data-quality/health");
});

// ── Walk-forward alias ─────────────────────────────────────────────────────
// Dashboard expects: POST /api/walk-forward/run
// Actual: POST /api/validation/walk-forward
router.post("/api/walk-forward/run", (req: Request, res: Response) => {
  // Forward body to the actual endpoint
  res.redirect(307, "/api/validation/walk-forward");
});

// ── Explainability replay alias ────────────────────────────────────────────
// Dashboard expects: /api/explainability/replay (singular)
// Actual: /api/explainability/replays (plural)
router.get("/api/explainability/replay", (_req: Request, res: Response) => {
  res.redirect(307, "/api/explainability/replays");
});

// ── Seed endpoint ──────────────────────────────────────────────────────────
// Dashboard may call POST /api/seed — provide a no-op success
router.post("/api/seed", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "Seeding is handled automatically at startup. No manual action needed.",
  });
});

// ── Brain endpoint aliases ─────────────────────────────────────────────────
// The brain router defines /brain/snapshot and /brain/consciousness handlers
// but the dashboard calls /api/brain/snapshot and /api/brain/consciousness,
// and the live probe shows those return 404 (likely shadowed by another mount).
// Re-implement them here as guaranteed reachable aliases that import the
// same business logic from lib/brain_bridge (imported at top of file).

router.get("/api/brain/snapshot", async (_req: Request, res: Response) => {
  try {
    const snap = await getLatestBrainSnapshot();
    if (!snap) {
      res.json({
        ok: false,
        connected: false,
        message: "Brain orchestrator artifact not found. Run a brain cycle to populate.",
        snapshot: null,
      });
      return;
    }
    res.json({ ok: true, snapshot: snap });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      message: "Brain bridge unavailable",
    });
  }
});

router.get("/api/brain/consciousness", async (_req: Request, res: Response) => {
  try {
    const cons = await getConsciousnessSnapshot();
    if (!cons) {
      res.json({
        ok: false,
        connected: false,
        message: "Consciousness snapshot not found. Run a brain cycle to populate.",
        consciousness: null,
      });
      return;
    }
    res.json({ ok: true, consciousness: cons });
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
      message: "Brain bridge unavailable",
    });
  }
});

// ── Regime endpoint aliases ────────────────────────────────────────────────
// Intelligence router exposes /regime/current, /optimizer/status, /mtf/confluence
// at /api/intelligence/*, but the dashboard calls /api/regime/state, /optimizer,
// /mtf. Forward each to the corresponding intelligence handler.
router.get("/api/regime/state", (_req: Request, res: Response) => {
  res.redirect(307, "/api/intelligence/regime/current");
});
router.get("/api/regime/mtf", (_req: Request, res: Response) => {
  res.redirect(307, "/api/intelligence/mtf/confluence");
});
router.get("/api/regime/optimizer", (_req: Request, res: Response) => {
  res.redirect(307, "/api/intelligence/optimizer/status");
});
router.get("/api/regime/profiles", (_req: Request, res: Response) => {
  res.redirect(307, "/api/intelligence/regime/profiles");
});

// ── System base alias ─────────────────────────────────────────────────────
// Dashboard probes GET /api/system as a "is the system layer alive" check.
// The system router only exposes /system/<sub-path> routes — add a base
// summary that points to the canonical sub-endpoints.
router.get("/api/system", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    system: "godsview",
    version: process.env.npm_package_version || "v1.0",
    endpoints: {
      status: "/api/system/status",
      health: "/api/system/health/deep",
      metrics: "/api/system/metrics  (operator-token)",
      kill_switch: "/api/system/kill-switch",
    },
    timestamp: new Date().toISOString(),
  });
});

// ── Market data aliases / stubs ───────────────────────────────────────────
// Dashboard expects /api/market/economic-indicators and /api/market/yield-curve.
// These need an external macro provider (FRED, Polygon, etc.) which the user
// has not configured (FRED is reported unavailable in app logs). Return a
// well-shaped "feed unconnected" response so the page can render an empty
// state instead of a 404 error banner.
router.get("/api/market/economic-indicators", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    feedConnected: false,
    indicators: [],
    message: "Macro provider not connected. Set FRED_API_KEY (or another provider) to populate.",
    lastUpdated: null,
  });
});

router.get("/api/market/yield-curve", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    feedConnected: false,
    yields: [],
    message: "Yield-curve provider not connected. Wire FRED or Treasury Direct to populate.",
    lastUpdated: null,
  });
});

// ── OpenBB research alias ─────────────────────────────────────────────────
// research.ts defines /research/openbb/latest. The probe shows it 404s — the
// research router's own mount path doesn't expose it under /api. Re-implement
// here so it's guaranteed reachable. Reads the OpenBB output file written by
// the side-pipeline if present; otherwise reports feed-not-connected.
router.get("/api/research/openbb/latest", async (_req: Request, res: Response) => {
  try {
    const fs = await import("node:fs/promises");
    const path = await import("node:path");
    const dataDir = process.env.GODSVIEW_OPENBB_DIR || "godsview-openbb/data/processed";
    const file = path.join(dataDir, "latest_research.json");
    try {
      const raw = await fs.readFile(file, "utf8");
      const parsed = JSON.parse(raw);
      res.json({ ok: true, source: "openbb", ...parsed });
      return;
    } catch {
      res.json({
        ok: true,
        feedConnected: false,
        items: [],
        message: `OpenBB integration not configured. Expected artifact at ${file}.`,
        lastUpdated: null,
      });
    }
  } catch (err) {
    res.status(503).json({
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});

// ─────────────────────────────────────────────────────────────────────────
// Phase 10 — final dashboard URL aliases (2026-04-27)
//
// Each entry below makes a dashboard fetch land on a real handler. Some
// rewrite to an existing internal route (via `internalGet`); others call
// the underlying lib function directly. The result: every page on the
// dashboard receives real data instead of a 4xx/5xx fallback.
// ─────────────────────────────────────────────────────────────────────────

// Internal HTTP helper: re-issues a GET against ourselves so we don't
// duplicate handler logic. Uses the loopback (the api process is bound
// on :3001 inside the container).
const INTERNAL_BASE = process.env.INTERNAL_API_BASE || "http://127.0.0.1:3001";

async function internalGet(path: string, headers?: Record<string, string>) {
  const url = path.startsWith("http") ? path : `${INTERNAL_BASE}${path}`;
  const r = await fetch(url, {
    method: "GET",
    headers: { accept: "application/json", ...(headers ?? {}) },
  });
  const text = await r.text();
  let body: any;
  try {
    body = JSON.parse(text);
  } catch {
    body = { raw: text };
  }
  return { status: r.status, body };
}

// ── 1. /api/market/orderbook?symbol=X → /api/orderbook/snapshot?symbol=X ──
// Used by: heatmap-liquidity, liquidity-environment
router.get("/api/market/orderbook", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "BTCUSD").toUpperCase();
  try {
    const { status, body } = await internalGet(`/api/orderbook/snapshot?symbol=${encodeURIComponent(symbol)}`);
    res.status(status).json(body);
  } catch (err) {
    logger.error(`[alias /api/market/orderbook] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "orderbook_unavailable", symbol });
  }
});

// ── 2. /api/market-structure?symbol=X → /api/market-structure/:symbol/analyze ──
// Used by: order-blocks
router.get("/api/market-structure", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "BTCUSD").toUpperCase();
  try {
    const { status, body } = await internalGet(`/api/market-structure/${encodeURIComponent(symbol)}/analyze`);
    res.status(status).json(body);
  } catch (err) {
    logger.error(`[alias /api/market-structure] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "market_structure_unavailable", symbol });
  }
});

// ── 3. /api/context-fusion/evaluate → /api/context/fusion/evaluate ──
// Used by: flow-confluence (note: hyphen vs slash in path)
router.get("/api/context-fusion/evaluate", async (req: Request, res: Response) => {
  const qs = req.url.includes("?") ? req.url.slice(req.url.indexOf("?")) : "";
  try {
    const { status, body } = await internalGet(`/api/context/fusion/evaluate${qs}`);
    res.status(status).json(body);
  } catch (err) {
    logger.error(`[alias /api/context-fusion/evaluate] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "context_fusion_unavailable" });
  }
});

// ── 4. /api/backtest/walk-forward → /api/backtest-v2/walk-forward ──
// Used by: walk-forward
router.get("/api/backtest/walk-forward", async (_req: Request, res: Response) => {
  try {
    const { status, body } = await internalGet("/api/backtest-v2/walk-forward");
    res.status(status).json(body);
  } catch (err) {
    logger.error(`[alias /api/backtest/walk-forward] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "walk_forward_unavailable" });
  }
});

// ── 5. /api/signal-engine/order-flow — local order-flow summary ──
// Used by: order-flow page. The Python signal engine doesn't expose
// /order-flow directly; we synthesize from microstructure for the
// requested symbol so the page always renders real data.
router.get("/api/signal-engine/order-flow", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "BTCUSD").toUpperCase();
  try {
    const { status, body } = await internalGet(`/api/microstructure/${encodeURIComponent(symbol)}/score`);
    if (status >= 400) {
      res.status(status).json(body);
      return;
    }
    res.json({
      symbol: body.symbol ?? symbol,
      generated_at: body.generated_at ?? new Date().toISOString(),
      delta: body.tape_summary?.normalized_delta ?? 0,
      bias: body.tape_summary?.bias ?? "neutral",
      score: body.score ?? 0,
      imbalance: body.imbalance ?? null,
      absorption: body.absorption ?? null,
      heatmap_zone_score: body.heatmap_summary?.zone_score ?? null,
      source: "microstructure_synth",
    });
  } catch (err) {
    logger.error(`[alias /api/signal-engine/order-flow] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "order_flow_unavailable", symbol });
  }
});

// ── 6. /api/microstructure/quality?symbol=X — wraps :symbol/score ──
// Used by: microstructure
router.get("/api/microstructure/quality", async (req: Request, res: Response) => {
  const symbol = String(req.query.symbol || "BTCUSD").toUpperCase();
  try {
    const { status, body } = await internalGet(`/api/microstructure/${encodeURIComponent(symbol)}/score`);
    res.status(status).json(body);
  } catch (err) {
    logger.error(`[alias /api/microstructure/quality] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "microstructure_quality_unavailable", symbol });
  }
});

// ── 7. /api/alpaca/quote/:symbol — single-symbol quote via getLatestTrade ──
// Used by: dom-depth
router.get("/api/alpaca/quote/:symbol", async (req: Request, res: Response) => {
  const symbol = String(req.params.symbol || "").toUpperCase();
  if (!symbol) {
    res.status(400).json({ error: "symbol required" });
    return;
  }
  try {
    const trade = await getLatestTrade(symbol);
    if (!trade) {
      const bar = await getLatestBar(symbol);
      if (!bar) {
        res.status(503).json({ error: "no_quote_available", symbol });
        return;
      }
      res.json({
        symbol,
        price: bar.close,
        timestamp: bar.timestamp,
        source: "latest_bar",
      });
      return;
    }
    res.json({
      symbol,
      price: trade.price,
      timestamp: trade.timestamp,
      source: "latest_trade",
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error(`[alias /api/alpaca/quote/:symbol] ${symbol} → ${msg}`);
    res.status(503).json({ error: "quote_unavailable", symbol, message: msg });
  }
});

// ── 8. /api/analytics/execution — aggregate exec metrics ──
// Used by: slippage-quality. Pulls from existing analytics endpoints
// rather than introducing a new service.
router.get("/api/analytics/execution", async (_req: Request, res: Response) => {
  try {
    const [summary, equity, daily] = await Promise.all([
      internalGet("/api/analytics/summary"),
      internalGet("/api/analytics/equity"),
      internalGet("/api/analytics/daily-pnl"),
    ]);
    const s = summary.body ?? {};
    const e = equity.body ?? {};
    const d = daily.body ?? {};
    res.json({
      generated_at: new Date().toISOString(),
      summary: {
        total_trades: s.total_trades ?? 0,
        win_rate: s.win_rate ?? null,
        avg_pnl: s.avg_pnl ?? null,
        sharpe: s.sharpe ?? null,
        profit_factor: s.profit_factor ?? null,
        max_drawdown: s.max_drawdown ?? null,
      },
      equity: {
        current: e.current ?? null,
        starting: e.starting ?? null,
        return_pct: e.return_pct ?? null,
      },
      daily: {
        pnl: d.pnl ?? null,
        trades: d.trades ?? null,
      },
      // Slippage panels need these — surface from summary if present.
      slippage_bps: s.slippage_bps ?? null,
      avg_fill_latency_ms: s.avg_fill_latency_ms ?? null,
      reject_rate: s.reject_rate ?? null,
    });
  } catch (err) {
    logger.error(`[alias /api/analytics/execution] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "execution_analytics_unavailable" });
  }
});

// ── 9. /api/system/intelligence-center — aggregate intelligence health ──
// Used by: intelligence-center. Combines the working intelligence
// subsystem reads (regime, mtf, optimizer) into a single payload.
router.get("/api/system/intelligence-center", async (_req: Request, res: Response) => {
  try {
    const [regime, mtf, optimizer] = await Promise.all([
      internalGet("/api/intelligence/regime/current"),
      internalGet("/api/intelligence/mtf/confluence"),
      internalGet("/api/intelligence/optimizer/status"),
    ]);
    res.json({
      generated_at: new Date().toISOString(),
      status: "operational",
      subsystems: {
        regime: {
          status: regime.status === 200 ? "ok" : "degraded",
          data: regime.body ?? null,
        },
        mtf_confluence: {
          status: mtf.status === 200 ? "ok" : "degraded",
          data: mtf.body ?? null,
        },
        adaptive_optimizer: {
          status: optimizer.status === 200 ? "ok" : "degraded",
          data: optimizer.body ?? null,
        },
      },
      uptime_s: Math.round(process.uptime()),
    });
  } catch (err) {
    logger.error(`[alias /api/system/intelligence-center] ${err instanceof Error ? err.message : err}`);
    res.status(503).json({ error: "intelligence_center_unavailable" });
  }
});

export default router;
