// ── Phase 110: Backtest Credibility Upgrade API ──────────────────────────────
// 7 endpoints for event-driven backtest results, credibility, overfit, leakage, walk-forward

import { Router, type Request, type Response } from "express";

const router = Router();

// ── Mock: Backtest Results ──────────────────────────────────────────────────

const BACKTESTS = [
  {
    id: "bt-001", strategy: "Mean Reversion v2", symbols: ["AAPL", "MSFT", "GOOGL"],
    startDate: "2024-01-02", endDate: "2025-12-31", initialCapital: 100000,
    metrics: { totalReturn: 18.4, annualReturn: 9.1, sharpe: 1.42, sortino: 1.87, maxDrawdown: -8.3, profitFactor: 1.65, winRate: 58.2, expectancy: 42.50, trades: 347, avgHoldingPeriodHrs: 28.5 },
    fees: { perShare: 0.005, perTrade: 1.0, platformFee: 0.001, ecnRebate: -0.002 },
    slippage: { type: "realistic", fixedBps: 5, volMultiplier: 1.2, impactCoeff: 0.1 },
    latencyMs: 50, partialFills: true, sessionBoundaries: true,
    equityCurve: Array.from({ length: 24 }, (_, i) => ({ date: `2024-${String(i + 1).padStart(2, "0")}`, equity: 100000 + i * 780 + Math.random() * 800 - 400, drawdown: -(Math.random() * 5) })),
    benchmark: { buyHold: 12.1, randomBaseline: 1.8, riskFree: 5.2, alpha: 6.3 },
    assumptions: ["Realistic slippage model", "Session boundaries enforced", "Partial fills enabled", "50ms latency modeled"],
    warnings: [],
    credibilityGrade: "A", overfitRisk: "low", promotable: true,
  },
  {
    id: "bt-002", strategy: "Momentum Breakout", symbols: ["SPY", "QQQ", "IWM"],
    startDate: "2024-06-01", endDate: "2025-12-31", initialCapital: 100000,
    metrics: { totalReturn: 32.7, annualReturn: 20.8, sharpe: 1.85, sortino: 2.34, maxDrawdown: -11.5, profitFactor: 2.10, winRate: 52.1, expectancy: 68.90, trades: 124, avgHoldingPeriodHrs: 72.3 },
    fees: { perShare: 0.005, perTrade: 1.0, platformFee: 0.001, ecnRebate: 0 },
    slippage: { type: "fixed", fixedBps: 3, volMultiplier: 0, impactCoeff: 0 },
    latencyMs: 10, partialFills: false, sessionBoundaries: true,
    equityCurve: Array.from({ length: 18 }, (_, i) => ({ date: `2024-${String(i + 7).padStart(2, "0")}`, equity: 100000 + i * 1850 + Math.random() * 1200 - 600, drawdown: -(Math.random() * 8) })),
    benchmark: { buyHold: 18.5, randomBaseline: 2.1, riskFree: 5.2, alpha: 14.2 },
    assumptions: ["Fixed 3bps slippage", "No partial fills", "10ms latency (optimistic)", "Session boundaries enforced"],
    warnings: ["Slippage model may be optimistic", "No partial fills — assumes 100% fill rate", "Low trade count (124)"],
    credibilityGrade: "B", overfitRisk: "moderate", promotable: true,
  },
  {
    id: "bt-003", strategy: "ML Ensemble Crypto", symbols: ["BTC/USD", "ETH/USD", "SOL/USD"],
    startDate: "2024-01-01", endDate: "2025-12-31", initialCapital: 50000,
    metrics: { totalReturn: 145.2, annualReturn: 68.3, sharpe: 3.21, sortino: 4.56, maxDrawdown: -15.2, profitFactor: 3.85, winRate: 67.8, expectancy: 215.40, trades: 89, avgHoldingPeriodHrs: 18.7 },
    fees: { perShare: 0, perTrade: 0, platformFee: 0.001, ecnRebate: 0 },
    slippage: { type: "fixed", fixedBps: 1, volMultiplier: 0, impactCoeff: 0 },
    latencyMs: 5, partialFills: false, sessionBoundaries: false,
    equityCurve: Array.from({ length: 24 }, (_, i) => ({ date: `2024-${String(i + 1).padStart(2, "0")}`, equity: 50000 + i * 3050 + Math.random() * 2000 - 1000, drawdown: -(Math.random() * 12) })),
    benchmark: { buyHold: 85.3, randomBaseline: 8.4, riskFree: 5.2, alpha: 59.9 },
    assumptions: ["Zero per-share/per-trade fees", "1bps slippage (too low for crypto)", "5ms latency (unrealistic)", "No session boundaries"],
    warnings: ["Zero trading fees — unrealistic", "Slippage 1bps too low for crypto", "Suspiciously high Sharpe (3.21)", "Only 89 trades — insufficient sample", "No walk-forward validation"],
    credibilityGrade: "D", overfitRisk: "high", promotable: false,
  },
];

// ── Mock: Credibility Reports ───────────────────────────────────────────────

const CREDIBILITY: Record<string, object> = {
  "bt-001": {
    backtestId: "bt-001", strategy: "Mean Reversion v2", credibilityScore: 92, grade: "A", promotable: true, gatingIssues: [],
    assumptions: [
      { id: "a01", category: "fees", name: "Per-share fees", value: "$0.005/share", isRealistic: true, impactEstimate: "negligible", description: "Matches Interactive Brokers tiered" },
      { id: "a02", category: "slippage", name: "Slippage model", value: "Realistic (vol-scaled + impact)", isRealistic: true, impactEstimate: "minor", description: "Combines volatility and volume impact" },
      { id: "a03", category: "latency", name: "Order latency", value: "50ms", isRealistic: true, impactEstimate: "negligible", description: "Conservative for co-lo" },
      { id: "a04", category: "execution", name: "Partial fills", value: "Enabled", isRealistic: true, impactEstimate: "minor", description: "Volume-based fill simulation" },
      { id: "a05", category: "execution", name: "Session boundaries", value: "Enforced", isRealistic: true, impactEstimate: "negligible", description: "No out-of-hours trading" },
      { id: "a06", category: "data", name: "Survivorship bias", value: "Controlled", isRealistic: true, impactEstimate: "negligible", description: "Historical constituents used" },
      { id: "a07", category: "market_structure", name: "Walk-forward", value: "5 windows, 70/30 split", isRealistic: true, impactEstimate: "negligible", description: "Rolling OOS validation" },
      { id: "a08", category: "data", name: "Look-ahead check", value: "Passed", isRealistic: true, impactEstimate: "negligible", description: "No future data detected" },
      { id: "a09", category: "fees", name: "Commission structure", value: "IB tiered", isRealistic: true, impactEstimate: "negligible", description: "Matches actual broker" },
      { id: "a10", category: "liquidity", name: "Market impact", value: "Volume-scaled", isRealistic: true, impactEstimate: "minor", description: "0.1 impact coefficient" },
    ],
    warnings: [],
  },
  "bt-003": {
    backtestId: "bt-003", strategy: "ML Ensemble Crypto", credibilityScore: 28, grade: "D", promotable: false,
    gatingIssues: ["Zero trading fees", "Slippage unrealistically low", "Insufficient trade count", "No walk-forward validation", "Sharpe ratio suspiciously high"],
    assumptions: [
      { id: "a01", category: "fees", name: "Per-share fees", value: "$0.00", isRealistic: false, impactEstimate: "severe", description: "Zero fees is unrealistic" },
      { id: "a02", category: "slippage", name: "Slippage model", value: "Fixed 1bps", isRealistic: false, impactEstimate: "severe", description: "Crypto typically 5-20bps" },
      { id: "a03", category: "latency", name: "Order latency", value: "5ms", isRealistic: false, impactEstimate: "moderate", description: "Crypto API typically 50-200ms" },
      { id: "a04", category: "execution", name: "Partial fills", value: "Disabled", isRealistic: false, impactEstimate: "moderate", description: "Assumes 100% fill — unrealistic" },
      { id: "a05", category: "execution", name: "Session boundaries", value: "None", isRealistic: true, impactEstimate: "negligible", description: "Crypto trades 24/7" },
      { id: "a06", category: "data", name: "Walk-forward", value: "Not performed", isRealistic: false, impactEstimate: "severe", description: "No OOS validation" },
      { id: "a07", category: "data", name: "Sample size", value: "89 trades", isRealistic: false, impactEstimate: "moderate", description: "Need >100 for significance" },
    ],
    warnings: ["CRITICAL: 5 severe assumption violations", "Strategy NOT promotable", "Re-run with realistic parameters before any capital allocation"],
  },
};

// ── Mock: Overfit Reports ───────────────────────────────────────────────────

const OVERFIT: Record<string, object> = {
  "bt-001": {
    backtestId: "bt-001", strategy: "Mean Reversion v2", overfitScore: 15, riskLevel: "low",
    tests: [
      { name: "IS/OOS Divergence", passed: true, score: 12, detail: "IS Sharpe 1.58, OOS Sharpe 1.32 — 1.2x ratio", threshold: 2.0 },
      { name: "Parameter Sensitivity", passed: true, score: 8, detail: "±10% param change yields ±4% return change", threshold: 20 },
      { name: "Regime Stability", passed: true, score: 18, detail: "Profitable in 3/4 regimes", threshold: 50 },
      { name: "Trade Count", passed: true, score: 5, detail: "347 trades — sufficient", threshold: 30 },
      { name: "Curve Fitting", passed: true, score: 10, detail: "3 params / 347 trades = 0.009", threshold: 0.1 },
      { name: "Time Stability", passed: true, score: 15, detail: "H1 Sharpe 1.38, H2 Sharpe 1.45", threshold: 50 },
      { name: "Monte Carlo", passed: true, score: 22, detail: "p=0.003 — strategy beats 99.7% of random", threshold: 5 },
      { name: "Drawdown Realism", passed: true, score: 20, detail: "Max DD 8.3% vs theoretical 12.1%", threshold: 50 },
    ],
    recommendation: "Low overfit risk. Strategy shows robust out-of-sample performance.",
  },
  "bt-003": {
    backtestId: "bt-003", strategy: "ML Ensemble Crypto", overfitScore: 78, riskLevel: "high",
    tests: [
      { name: "IS/OOS Divergence", passed: false, score: 85, detail: "No OOS data available — walk-forward not performed", threshold: 2.0 },
      { name: "Parameter Sensitivity", passed: false, score: 72, detail: "±10% param change yields ±35% return change", threshold: 20 },
      { name: "Regime Stability", passed: false, score: 68, detail: "Profitable in 1/4 regimes only (bull)", threshold: 50 },
      { name: "Trade Count", passed: false, score: 75, detail: "89 trades — insufficient for ML strategy", threshold: 30 },
      { name: "Curve Fitting", passed: false, score: 90, detail: "15 params / 89 trades = 0.169 — too many params", threshold: 0.1 },
      { name: "Time Stability", passed: false, score: 82, detail: "H1 return 120%, H2 return 25% — significant decay", threshold: 50 },
      { name: "Monte Carlo", passed: true, score: 35, detail: "p=0.02 — marginally significant", threshold: 5 },
      { name: "Drawdown Realism", passed: false, score: 65, detail: "Max DD 15.2% vs theoretical 42.8% — suspiciously low", threshold: 50 },
    ],
    recommendation: "HIGH overfit risk. Strategy likely curve-fitted to bull market. Do NOT promote. Re-run with walk-forward validation and realistic assumptions.",
  },
};

// ── Mock: Leakage ───────────────────────────────────────────────────────────

const LEAKAGE: Record<string, object> = {
  "bt-001": {
    backtestId: "bt-001", hasLeakage: false, severity: "none",
    features: [
      { feature: "SMA_20", type: "look_ahead", detected: false, description: "Uses trailing 20-bar average — clean" },
      { feature: "RSI_14", type: "look_ahead", detected: false, description: "Standard RSI — no future data" },
      { feature: "volume_ratio", type: "target_leak", detected: false, description: "Volume relative to 20-bar avg — clean" },
      { feature: "regime_label", type: "temporal_leak", detected: false, description: "Regime calculated from past data only" },
    ],
  },
  "bt-003": {
    backtestId: "bt-003", hasLeakage: true, severity: "major",
    features: [
      { feature: "future_vol_5d", type: "look_ahead", detected: true, description: "Uses 5-day forward volatility — LOOK-AHEAD BIAS" },
      { feature: "ml_target_normalized", type: "target_leak", detected: true, description: "Feature derived from target variable" },
      { feature: "cross_val_score", type: "temporal_leak", detected: true, description: "Train/test data overlap detected" },
      { feature: "momentum_12m", type: "survivorship", detected: false, description: "Clean — uses historical universe" },
    ],
  },
};

// ── Mock: Walk-Forward ──────────────────────────────────────────────────────

const WALK_FORWARD: Record<string, object> = {
  "bt-001": {
    backtestId: "bt-001", windows: 5, inSamplePct: 70, outSamplePct: 30,
    results: [
      { window: 1, isSharpe: 1.52, oosSharpe: 1.28, isReturn: 4.2, oosReturn: 3.1, divergence: 0.19 },
      { window: 2, isSharpe: 1.65, oosSharpe: 1.41, isReturn: 5.1, oosReturn: 4.3, divergence: 0.15 },
      { window: 3, isSharpe: 1.38, oosSharpe: 1.22, isReturn: 3.8, oosReturn: 3.0, divergence: 0.12 },
      { window: 4, isSharpe: 1.71, oosSharpe: 1.48, isReturn: 5.6, oosReturn: 4.8, divergence: 0.13 },
      { window: 5, isSharpe: 1.44, oosSharpe: 1.35, isReturn: 4.0, oosReturn: 3.5, divergence: 0.07 },
    ],
    avgDivergence: 0.13, overfitFlag: false,
    summary: "Stable IS/OOS relationship. Average divergence 13% — within acceptable range.",
  },
};

// ── Mock: Paper Comparison ──────────────────────────────────────────────────

const COMPARISON: Record<string, object> = {
  "bt-001": {
    backtestId: "bt-001",
    metrics: [
      { name: "Total Return", backtest: 18.4, paper: 15.8, deviation: 14.1, flagged: false },
      { name: "Sharpe Ratio", backtest: 1.42, paper: 1.28, deviation: 9.8, flagged: false },
      { name: "Max Drawdown", backtest: -8.3, paper: -9.7, deviation: 16.9, flagged: false },
      { name: "Win Rate", backtest: 58.2, paper: 55.8, deviation: 4.1, flagged: false },
      { name: "Profit Factor", backtest: 1.65, paper: 1.52, deviation: 7.9, flagged: false },
    ],
    overallDeviation: 10.6, acceptable: true,
    summary: "Backtest and paper results are within 15% across all metrics — good alignment.",
  },
};

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/results", (_req: Request, res: Response) => {
  res.json({ backtests: BACKTESTS, total: BACKTESTS.length });
});

router.get("/credibility/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const report = CREDIBILITY[id];
  if (!report) return res.status(404).json({ error: "Backtest not found" });
  return res.json(report);
});

router.get("/overfit/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const report = OVERFIT[id];
  if (!report) return res.status(404).json({ error: "Backtest not found" });
  return res.json(report);
});

router.get("/leakage/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const report = LEAKAGE[id];
  if (!report) return res.status(404).json({ error: "Backtest not found" });
  return res.json(report);
});

router.get("/walk-forward/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const report = WALK_FORWARD[id];
  if (!report) return res.status(404).json({ error: "Walk-forward not available" });
  return res.json(report);
});

router.get("/comparison/:id", (req: Request, res: Response) => {
  const id = req.params.id as string;
  const report = COMPARISON[id];
  if (!report) return res.status(404).json({ error: "Paper comparison not available" });
  return res.json(report);
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational",
    module: "backtest-v2",
    phase: 110,
    backtestsAvailable: BACKTESTS.length,
    uptime: process.uptime(),
    timestamp: Date.now(),
  });
});

export default router;
