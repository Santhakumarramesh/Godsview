/**
 * Phase 101 — Regime-Adaptive Intelligence API
 *
 * Endpoints:
 *   GET  /regime/current         — Current regime + routing recommendation
 *   GET  /regime/profiles         — All regime performance profiles
 *   POST /regime/route            — Route a signal through regime filter
 *   GET  /mtf/confluence          — Multi-timeframe alignment snapshot
 *   GET  /optimizer/status        — Adaptive optimizer state
 *   POST /optimizer/learn         — Feed outcome to optimizer
 *   GET  /intelligence/health     — Subsystem health
 */

import { Router, type Request, type Response } from "express";

const router = Router();

// ── Types ───────────────────────────────────────────────────────────────────
type BasicRegime = "trend_up" | "trend_down" | "range" | "compression" | "expansion" | "chaotic";

interface RegimeProfile {
  regime: BasicRegime;
  totalSignals: number;
  wins: number;
  losses: number;
  winRate: number;
  avgReturn: number;
  avgLoss: number;
  expectancy: number;
  bestSetups: string[];
  blocked: boolean;
  lastUpdated: string;
}

interface TimeframeAnalysis {
  tf: string;
  trend: "bullish" | "bearish" | "neutral";
  strength: number;
  rsi: number;
  atr: number;
  ema20: number;
  ema50: number;
  weight: number;
}

interface OptimizationRule {
  parameter: string;
  currentValue: number;
  suggestedValue: number;
  delta: number;
  reason: string;
  sampleSize: number;
  confidence: number;
}

// ── Mock State ──────────────────────────────────────────────────────────────
const currentRegime: BasicRegime = "trend_up";
const regimeConfidence = 0.78;
const regimeStartedAt = new Date(Date.now() - 4 * 3600_000).toISOString();

const regimeProfiles: RegimeProfile[] = [
  {
    regime: "trend_up",
    totalSignals: 142,
    wins: 96,
    losses: 46,
    winRate: 0.676,
    avgReturn: 2.3,
    avgLoss: -1.1,
    expectancy: 1.05,
    bestSetups: ["breakout", "pullback_continuation", "momentum_surge"],
    blocked: false,
    lastUpdated: new Date(Date.now() - 600_000).toISOString(),
  },
  {
    regime: "trend_down",
    totalSignals: 98,
    wins: 58,
    losses: 40,
    winRate: 0.592,
    avgReturn: 2.8,
    avgLoss: -1.4,
    expectancy: 1.1,
    bestSetups: ["breakdown", "dead_cat_bounce", "reversal"],
    blocked: false,
    lastUpdated: new Date(Date.now() - 900_000).toISOString(),
  },
  {
    regime: "range",
    totalSignals: 87,
    wins: 44,
    losses: 43,
    winRate: 0.506,
    avgReturn: 1.5,
    avgLoss: -1.3,
    expectancy: 0.12,
    bestSetups: ["mean_reversion", "range_fade"],
    blocked: false,
    lastUpdated: new Date(Date.now() - 1200_000).toISOString(),
  },
  {
    regime: "compression",
    totalSignals: 53,
    wins: 32,
    losses: 21,
    winRate: 0.604,
    avgReturn: 3.1,
    avgLoss: -1.0,
    expectancy: 1.67,
    bestSetups: ["squeeze_breakout", "volatility_expansion"],
    blocked: false,
    lastUpdated: new Date(Date.now() - 1800_000).toISOString(),
  },
  {
    regime: "expansion",
    totalSignals: 41,
    wins: 22,
    losses: 19,
    winRate: 0.537,
    avgReturn: 4.2,
    avgLoss: -2.1,
    expectancy: 1.25,
    bestSetups: ["trend_continuation", "breakout"],
    blocked: false,
    lastUpdated: new Date(Date.now() - 2400_000).toISOString(),
  },
  {
    regime: "chaotic",
    totalSignals: 34,
    wins: 9,
    losses: 25,
    winRate: 0.265,
    avgReturn: 1.2,
    avgLoss: -1.8,
    expectancy: -1.18,
    bestSetups: [],
    blocked: true,
    lastUpdated: new Date(Date.now() - 3600_000).toISOString(),
  },
];

const mtfAnalysis: TimeframeAnalysis[] = [
  { tf: "1m", trend: "bullish", strength: 0.62, rsi: 58.3, atr: 0.12, ema20: 185.4, ema50: 184.9, weight: 0.05 },
  { tf: "5m", trend: "bullish", strength: 0.71, rsi: 61.2, atr: 0.28, ema20: 185.2, ema50: 184.6, weight: 0.15 },
  { tf: "15m", trend: "bullish", strength: 0.68, rsi: 56.8, atr: 0.45, ema20: 184.8, ema50: 184.1, weight: 0.25 },
  { tf: "1h", trend: "neutral", strength: 0.49, rsi: 52.1, atr: 1.12, ema20: 184.2, ema50: 183.5, weight: 0.30 },
  { tf: "1d", trend: "bullish", strength: 0.74, rsi: 63.4, atr: 3.45, ema20: 182.1, ema50: 179.8, weight: 0.25 },
];

const optimizationRules: OptimizationRule[] = [
  {
    parameter: "minConfidence",
    currentValue: 0.65,
    suggestedValue: 0.62,
    delta: -0.03,
    reason: "Loosening threshold — regime trend_up win rate 67.6% over 142 signals",
    sampleSize: 142,
    confidence: 0.82,
  },
  {
    parameter: "riskMultiplier",
    currentValue: 1.0,
    suggestedValue: 1.15,
    delta: 0.15,
    reason: "Positive expectancy in current regime supports modest risk increase",
    sampleSize: 142,
    confidence: 0.76,
  },
  {
    parameter: "maxConcurrentTrades",
    currentValue: 3,
    suggestedValue: 4,
    delta: 1,
    reason: "Win-streak of 8; correlation between signals is low (r=0.12)",
    sampleSize: 52,
    confidence: 0.68,
  },
];

// ── GET /regime/current ─────────────────────────────────────────────────────
router.get("/regime/current", (_req: Request, res: Response) => {
  const profile = regimeProfiles.find((p) => p.regime === currentRegime)!;
  res.json({
    regime: currentRegime,
    confidence: regimeConfidence,
    startedAt: regimeStartedAt,
    durationMinutes: Math.round((Date.now() - new Date(regimeStartedAt).getTime()) / 60_000),
    profile,
    recommendation: profile.blocked
      ? "HALT — regime historically unprofitable"
      : profile.expectancy > 1
        ? "FULL_SEND — high expectancy"
        : profile.expectancy > 0
          ? "PROCEED_CAUTIOUS — marginal edge"
          : "REDUCE_SIZE — negative expectancy",
  });
});

// ── GET /regime/profiles ────────────────────────────────────────────────────
router.get("/regime/profiles", (_req: Request, res: Response) => {
  res.json({
    profiles: regimeProfiles,
    activeRegime: currentRegime,
    totalSignalsAllRegimes: regimeProfiles.reduce((s, p) => s + p.totalSignals, 0),
    blockedRegimes: regimeProfiles.filter((p) => p.blocked).map((p) => p.regime),
  });
});

// ── POST /regime/route ──────────────────────────────────────────────────────
router.post("/regime/route", (req: Request, res: Response) => {
  const { signalType, confidence: sigConf } = req.body || {};
  const profile = regimeProfiles.find((p) => p.regime === currentRegime)!;
  const isBlocked = profile.blocked;
  const isSetupMatch = profile.bestSetups.includes(signalType ?? "");
  const passed = !isBlocked && (isSetupMatch || (sigConf ?? 0) > 0.75);

  res.json({
    regime: currentRegime,
    signalType: signalType ?? "unknown",
    routed: passed,
    reason: isBlocked
      ? `Regime ${currentRegime} is blocked — win rate ${(profile.winRate * 100).toFixed(1)}% below threshold`
      : !isSetupMatch && (sigConf ?? 0) <= 0.75
        ? `Signal type not in best setups for ${currentRegime} and confidence too low`
        : `Signal accepted — ${currentRegime} regime, setup ${isSetupMatch ? "matched" : "override by high confidence"}`,
    profile: { winRate: profile.winRate, expectancy: profile.expectancy, blocked: profile.blocked },
  });
});

// ── GET /mtf/confluence ─────────────────────────────────────────────────────
router.get("/mtf/confluence", (_req: Request, res: Response) => {
  const weightedAlignment = mtfAnalysis.reduce((sum, tf) => {
    const dirScore = tf.trend === "bullish" ? tf.strength : tf.trend === "bearish" ? -tf.strength : 0;
    return sum + dirScore * tf.weight;
  }, 0);

  const bullishCount = mtfAnalysis.filter((t) => t.trend === "bullish").length;
  const bearishCount = mtfAnalysis.filter((t) => t.trend === "bearish").length;
  const neutralCount = mtfAnalysis.filter((t) => t.trend === "neutral").length;

  let recommendation: string;
  if (weightedAlignment > 0.5) recommendation = "strong_confirm";
  else if (weightedAlignment > 0.2) recommendation = "moderate_confirm";
  else if (weightedAlignment > -0.2) recommendation = "weak_confirm";
  else recommendation = "conflict";

  res.json({
    timeframes: mtfAnalysis,
    alignment: {
      score: Math.round(weightedAlignment * 1000) / 1000,
      bullishCount,
      bearishCount,
      neutralCount,
      recommendation,
    },
    boostFactor:
      recommendation === "strong_confirm"
        ? 0.2
        : recommendation === "moderate_confirm"
          ? 0.1
          : recommendation === "conflict"
            ? -0.2
            : 0,
  });
});

// ── GET /optimizer/status ───────────────────────────────────────────────────
router.get("/optimizer/status", (_req: Request, res: Response) => {
  res.json({
    enabled: true,
    currentRegime,
    rules: optimizationRules,
    guardrails: {
      maxChangePercent: 10,
      minSampleSize: 20,
      cooldownTrades: 10,
    },
    lastOptimization: new Date(Date.now() - 45 * 60_000).toISOString(),
    nextEligible: new Date(Date.now() + 15 * 60_000).toISOString(),
  });
});

// ── POST /optimizer/learn ───────────────────────────────────────────────────
router.post("/optimizer/learn", (req: Request, res: Response) => {
  const { tradeId, regime, outcome, pnl } = req.body || {};
  res.json({
    accepted: true,
    tradeId: tradeId ?? "unknown",
    regime: regime ?? currentRegime,
    outcome: outcome ?? (pnl > 0 ? "win" : "loss"),
    pnl: pnl ?? 0,
    message: "Outcome ingested — optimizer will re-evaluate after cooldown",
  });
});

// ── GET /intelligence/health ────────────────────────────────────────────────
router.get("/intelligence/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    subsystems: {
      regimeRouter: { status: "ok", activeRegime: currentRegime, confidence: regimeConfidence },
      mtfConfluence: { status: "ok", timeframesTracked: mtfAnalysis.length, lastUpdate: new Date().toISOString() },
      adaptiveOptimizer: {
        status: "ok",
        pendingRules: optimizationRules.length,
        lastOptimization: new Date(Date.now() - 45 * 60_000).toISOString(),
      },
    },
    uptime: process.uptime(),
  });
});

export default router;
