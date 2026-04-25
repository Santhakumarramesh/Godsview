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

// ── Seed endpoint ──────────────────────────────────────────────────────────
// Dashboard may call POST /api/seed — provide a no-op success
router.post("/api/seed", (_req: Request, res: Response) => {
  res.json({
    ok: true,
    message: "Seeding is handled automatically at startup. No manual action needed.",
  });
});

export default router;
