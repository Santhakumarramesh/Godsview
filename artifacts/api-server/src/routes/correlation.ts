/**
 * Phase 102 — Correlation & Portfolio Heat Map API
 *
 * Endpoints:
 *   GET  /matrix       — NxN strategy correlation matrix
 *   GET  /dangers      — Dangerously correlated pairs
 *   GET  /heatmap      — Sector × timeframe portfolio heat map
 *   GET  /drawdown     — Live drawdown state + equity curve
 *   GET  /exposure     — Portfolio exposure breakdown
 *   GET  /health       — Subsystem health
 */

import { Router, type Request, type Response } from "express";

const router = Router();

// ── Mock Data ───────────────────────────────────────────────────────────────
const strategies = ["Breakout_V3", "MeanRevert_V2", "Momentum_Alpha", "SMC_Sniper", "Divergence_Pro"];

const correlationMatrix = [
  [ 1.00,  0.12, 0.78, 0.34, -0.15],
  [ 0.12,  1.00, -0.08, 0.21,  0.65],
  [ 0.78, -0.08, 1.00, 0.42,  -0.22],
  [ 0.34,  0.21, 0.42, 1.00,  0.11],
  [-0.15,  0.65, -0.22, 0.11,  1.00],
];

const dangerousPairs = [
  {
    strategy_a: "Breakout_V3",
    strategy_b: "Momentum_Alpha",
    correlation: 0.78,
    risk_level: "dangerous" as const,
    recommendation: "Reduce combined allocation by 30% — both chase momentum breakouts in the same regime.",
  },
];

const sectors = ["Tech", "Energy", "Finance", "Healthcare", "Crypto"];
const timeframes = ["1d", "1w", "1m", "3m"];

function riskColor(score: number): string {
  if (score < 0.3) return "#00e676";
  if (score < 0.6) return "#ffd740";
  if (score < 0.8) return "#ff9100";
  return "#ff5252";
}

const heatmapCells = sectors.map((sector) =>
  timeframes.map((tf) => {
    const risk = Math.round(Math.random() * 100) / 100;
    return {
      sector,
      timeframe: tf,
      exposure: Math.round(Math.random() * 50000),
      pnl: Math.round((Math.random() - 0.4) * 3000),
      positionCount: Math.floor(Math.random() * 8) + 1,
      riskScore: risk,
      color: riskColor(risk),
    };
  })
);

const equityCurve: { timestamp: string; equity: number }[] = [];
let eq = 100000;
for (let i = 30; i >= 0; i--) {
  eq += (Math.random() - 0.45) * 800;
  equityCurve.push({
    timestamp: new Date(Date.now() - i * 86400_000).toISOString(),
    equity: Math.round(eq * 100) / 100,
  });
}
const hwm = Math.max(...equityCurve.map((e) => e.equity));
const currentEq = equityCurve[equityCurve.length - 1].equity;
const currentDD = (hwm - currentEq) / hwm;

// ── GET /matrix ─────────────────────────────────────────────────────────────
router.get("/matrix", (_req: Request, res: Response) => {
  res.json({
    strategies,
    matrix: correlationMatrix,
    computed_at: new Date().toISOString(),
    diversificationScore: 68,
    trend: "stable",
  });
});

// ── GET /dangers ────────────────────────────────────────────────────────────
router.get("/dangers", (_req: Request, res: Response) => {
  res.json({
    pairs: dangerousPairs,
    threshold: 0.7,
    totalPairsChecked: (strategies.length * (strategies.length - 1)) / 2,
    dangerousCount: dangerousPairs.length,
  });
});

// ── GET /heatmap ────────────────────────────────────────────────────────────
router.get("/heatmap", (_req: Request, res: Response) => {
  res.json({
    cells: heatmapCells,
    sectors,
    timeframes,
    maxExposure: Math.max(...heatmapCells.flat().map((c) => c.exposure)),
    totalExposure: heatmapCells.flat().reduce((s, c) => s + c.exposure, 0),
    generated_at: new Date().toISOString(),
  });
});

// ── GET /drawdown ───────────────────────────────────────────────────────────
router.get("/drawdown", (_req: Request, res: Response) => {
  const severity =
    currentDD < 0.02 ? "none" : currentDD < 0.05 ? "minor" : currentDD < 0.08 ? "moderate" : currentDD < 0.12 ? "severe" : "critical";

  res.json({
    currentDrawdown: Math.round(currentDD * 10000) / 10000,
    peakEquity: hwm,
    currentEquity: currentEq,
    troughEquity: Math.min(...equityCurve.map((e) => e.equity)),
    isInDrawdown: currentDD > 0.01,
    severity,
    circuitBreakerTriggered: currentDD > 0.10,
    equityCurve,
    recovery: {
      avgRecoveryTime: 4.2,
      medianRecoveryTime: 3.0,
      fastestRecovery: 1,
      slowestRecovery: 12,
      recoveryRate: 0.82,
      currentStreak: currentDD > 0.01 ? -2 : 3,
    },
    stats: {
      cagr: 0.342,
      volatility: 0.18,
      sharpe: 1.9,
      sortino: 2.4,
      calmar: 3.42,
      maxDrawdown: 0.097,
      highWaterMark: hwm,
    },
  });
});

// ── GET /exposure ───────────────────────────────────────────────────────────
router.get("/exposure", (_req: Request, res: Response) => {
  const bySector: Record<string, number> = {};
  for (const row of heatmapCells) {
    const cell = row[0]; // 1d timeframe
    bySector[cell.sector] = (bySector[cell.sector] || 0) + cell.exposure;
  }
  const gross = Object.values(bySector).reduce((s, v) => s + Math.abs(v), 0);
  const net = Object.values(bySector).reduce((s, v) => s + v, 0);

  res.json({
    bySector,
    byDirection: { long: Math.round(gross * 0.62), short: Math.round(gross * 0.38) },
    netExposure: net,
    grossExposure: gross,
  });
});

// ── GET /health ─────────────────────────────────────────────────────────────
router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    subsystems: {
      strategyCorrelator: { status: "ok", strategies: strategies.length, lastCompute: new Date().toISOString() },
      portfolioHeatmap: { status: "ok", sectors: sectors.length, positions: 23 },
      drawdownAnalyzer: { status: "ok", currentDD: Math.round(currentDD * 10000) / 100 + "%", circuitBreaker: currentDD > 0.10 },
    },
    uptime: process.uptime(),
  });
});

export default router;
