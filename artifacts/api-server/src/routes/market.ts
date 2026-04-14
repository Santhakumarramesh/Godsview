/**
 * market.ts — Market data and execution API routes (Phase 5)
 *
 * Routes:
 * - GET /api/market/bars/:symbol — Normalized market bars
 * - GET /api/market/price/:symbol — Current price with best source
 * - GET /api/market/health — Feed health report
 * - GET /api/market/execution/stats — Execution quality metrics
 * - GET /api/market/replay/:id — Replay a stored decision
 * - POST /api/market/replay/query — Query decisions
 * - GET /api/market/latency — Feed latency statistics
 */

import { Router, Request, Response } from "express";
import {
  DataNormalizer,
  FeedManager,
  ExecutionSimulator,
  ReplayStore,
} from "../lib/market";

const router = Router();

// ─── Singleton instances ───────────────────────────────────────────────────

const normalizer = new DataNormalizer();
const feedManager = new FeedManager();
const executionSimulator = new ExecutionSimulator();
const replayStore = new ReplayStore();

// Configure feed manager with available providers
// (In production, these would be registered from config)
let feedManagerReady = false;

function initializeFeedManager() {
  if (feedManagerReady) return;

  // Register Alpaca provider
  feedManager.registerProvider("alpaca", {
    name: "alpaca",
    type: "rest",
    symbols: ["AAPL", "MSFT", "GOOGL", "AMZN", "TSLA", "SPY", "QQQ"],
    timeframes: ["1m", "5m", "15m", "1h", "1d"],
    priority: 1,
    async fetchBars(symbol: string, timeframe: string, limit: number) {
      // Would call Alpaca API
      return { bars: {} };
    },
    isHealthy() {
      return true;
    },
  });

  feedManagerReady = true;
}

// ─── GET /api/market/bars/:symbol ──────────────────────────────────────────

router.get("/bars/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol as string;
    const { timeframe = "1d", limit = 100, provider } = req.query;

    if (!symbol) {
      return res.status(400).json({ error: "symbol required" });
    }

    initializeFeedManager();

    // Get bars from feed manager
    const bars = await feedManager.getBars(
      symbol.toUpperCase(),
      String(timeframe),
      parseInt(String(limit), 10) || 100
    );

    // Clean the data
    const { cleaned, issues } = normalizer.cleanData(bars);

    return res.json({
      symbol: symbol.toUpperCase(),
      timeframe,
      count: cleaned.length,
      bars: cleaned,
      dataQuality: {
        issueCount: issues.length,
        issues: issues.slice(0, 10), // Top 10 issues
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── GET /api/market/price/:symbol ────────────────────────────────────────

router.get("/price/:symbol", async (req: Request, res: Response) => {
  try {
    const symbol = req.params.symbol as string;

    if (!symbol) {
      return res.status(400).json({ error: "symbol required" });
    }

    initializeFeedManager();

    const priceSnapshot = await feedManager.getPrice(symbol.toUpperCase());

    return res.json({
      symbol: priceSnapshot.symbol,
      price: priceSnapshot.price,
      bid: priceSnapshot.bid,
      ask: priceSnapshot.ask,
      volume: priceSnapshot.volume,
      provider: priceSnapshot.provider,
      timestamp: new Date(priceSnapshot.timestamp).toISOString(),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── GET /api/market/health ────────────────────────────────────────────────

router.get("/health", (req: Request, res: Response) => {
  try {
    initializeFeedManager();

    const report = feedManager.checkHealth();

    return res.json({
      overall: report.overall,
      timestamp: new Date(report.timestamp).toISOString(),
      providers: report.providers.map((p) => ({
        name: p.provider,
        status: p.status,
        latencyMs: p.latencyMs.toFixed(1),
        errorRate: (p.errorRate * 100).toFixed(1) + "%",
        uptime: p.uptime.toFixed(1) + "%",
        lastCheck: new Date(p.lastCheck).toISOString(),
        lastError: p.lastError,
      })),
      coveredSymbols: report.coveredSymbols,
      uncoveredSymbols: report.uncoveredSymbols,
      recommendations: report.recommendations,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── GET /api/market/execution/stats ───────────────────────────────────────

router.get("/execution/stats", (req: Request, res: Response) => {
  try {
    const stats = executionSimulator.getExecutionStats();

    return res.json({
      totalOrders: stats.totalOrders,
      totalFills: stats.totalFills,
      fillRate: (stats.fillRate * 100).toFixed(1) + "%",
      metrics: {
        avgSlippageBps: stats.avgSlippageBps.toFixed(2),
        avgSpreadBps: stats.avgSpreadBps.toFixed(2),
        avgLatencyMs: stats.avgLatencyMs.toFixed(1),
      },
      costs: {
        totalCommission: stats.totalCommission.toFixed(2),
        totalMarketImpact: stats.totalMarketImpact.toFixed(2),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── GET /api/market/latency ───────────────────────────────────────────────

router.get("/latency", (req: Request, res: Response) => {
  try {
    initializeFeedManager();

    const latency = feedManager.getLatencyStats();

    return res.json({
      averageLatencyMs: latency.averageLatencyMs.toFixed(1),
      medianLatencyMs: latency.medianLatencyMs.toFixed(1),
      percentiles: {
        p95: latency.p95LatencyMs.toFixed(1),
        p99: latency.p99LatencyMs.toFixed(1),
      },
      providers: latency.providerStats,
      slowest: latency.slowestProvider,
      fastest: latency.fastestProvider,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── GET /api/market/replay/:id ────────────────────────────────────────────

router.get("/replay/:id", (req: Request, res: Response) => {
  try {
    const id = req.params.id as string;

    const decision = replayStore.replay(id);
    if (!decision) {
      return res.status(404).json({ error: `Decision ${id} not found` });
    }

    return res.json({
      id: decision.id,
      timestamp: new Date(decision.timestamp).toISOString(),
      symbol: decision.symbol,
      decision: decision.decision,
      price: decision.price,
      brainScore: decision.brainScore.toFixed(2),
      siApproval: decision.siApproval,
      reasoning: decision.reasoning,
      indicators: decision.indicators,
      outcome: decision.outcome
        ? {
            pnl: decision.outcome.pnl.toFixed(2),
            rMultiple: decision.outcome.rMultiple.toFixed(2),
            holdBars: decision.outcome.holdBars,
            exitPrice: decision.outcome.exitPrice.toFixed(2),
            exitTime: new Date(decision.outcome.exitTime).toISOString(),
          }
        : null,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── POST /api/market/replay/query ─────────────────────────────────────────

router.post("/replay/query", (req: Request, res: Response) => {
  try {
    const {
      symbol,
      decisionType,
      startTime,
      endTime,
      minBrainScore,
      siApprovedOnly,
    } = req.body;

    const filter: any = {};
    if (symbol) filter.symbol = symbol.toUpperCase();
    if (decisionType) filter.decisionType = decisionType;
    if (startTime) filter.startTime = startTime;
    if (endTime) filter.endTime = endTime;
    if (minBrainScore) filter.minBrainScore = minBrainScore;
    if (siApprovedOnly) filter.siApprovedOnly = siApprovedOnly;

    const results = replayStore.query(filter);

    return res.json({
      count: results.length,
      decisions: results.map((d) => ({
        id: d.id,
        timestamp: new Date(d.timestamp).toISOString(),
        symbol: d.symbol,
        decision: d.decision,
        price: d.price.toFixed(2),
        brainScore: d.brainScore.toFixed(2),
        siApproval: d.siApproval,
        pnl: d.outcome?.pnl.toFixed(2),
        rMultiple: d.outcome?.rMultiple.toFixed(2),
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── GET /api/market/replay/stats ─────────────────────────────────────────

router.get("/replay/stats", (req: Request, res: Response) => {
  try {
    const stats = replayStore.getStats();

    return res.json({
      totalDecisions: stats.totalDecisions,
      symbolsTracked: Array.from(stats.symbolsTracked),
      dateRange: {
        from: stats.dateRange.from ? new Date(stats.dateRange.from).toISOString() : null,
        to: stats.dateRange.to ? new Date(stats.dateRange.to).toISOString() : null,
      },
      performance: {
        averageHoldBars: stats.averageHoldBars.toFixed(1),
        winRate: (stats.winRate * 100).toFixed(1) + "%",
        totalPnL: stats.totalPnL.toFixed(2),
        averageRMultiple: stats.averageRMultiple.toFixed(2),
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── POST /api/market/replay/store ────────────────────────────────────────

router.post("/replay/store", (req: Request, res: Response) => {
  try {
    const decision = req.body;

    const id = replayStore.storeDecision(decision);

    return res.json({
      success: true,
      id,
      message: "Decision stored",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

// ─── POST /api/market/replay/whatif ───────────────────────────────────────

router.post("/replay/whatif", (req: Request, res: Response) => {
  try {
    const { decisionId, alternatives } = req.body;

    if (!decisionId) {
      return res.status(400).json({ error: "decisionId required" });
    }

    const results = replayStore.whatIf(decisionId, alternatives || []);

    return res.json({
      decisionId,
      scenarioCount: results.length,
      scenarios: results.map((r) => ({
        scenarioId: r.scenarioId,
        pnlDifference: r.pnlDifference.toFixed(2),
        rMultipleDifference: r.rMultipleDifference.toFixed(2),
        recommendation: r.recommendation,
      })),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: message });
  }
});

export default router;