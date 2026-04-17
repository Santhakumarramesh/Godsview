// ── Phase 113: Model Governance API ──────────────────────────────────────────
// 7 endpoints for model registry, features, datasets, drift, shadows, timeline

import { Router, type Request, type Response } from "express";

const router = Router();
const now = Date.now();

// ── Mock: Models ────────────────────────────────────────────────────────────

const MODELS = [
  {
    id: "mdl_001", name: "Regime Classifier", version: "2.3.1", type: "classifier",
    status: "champion", features: ["feat_sma20", "feat_rsi14", "feat_vol20", "feat_atr14", "feat_regime"],
    datasetId: "ds_001", owner: "quant-team",
    metrics: { accuracy: 0.78, precision: 0.81, recall: 0.74, f1: 0.77, sharpe: 1.45, profitFactor: 1.62, maxDrawdown: -8.2, trainingLoss: 0.32, validationLoss: 0.35, overfitRatio: 1.09 },
    createdAt: now - 30 * 86400000, promotedAt: now - 21 * 86400000,
    hash: "sha256:a1b2c3d4e5f6", tags: ["production", "regime"],
    parentVersion: "2.2.0",
  },
  {
    id: "mdl_002", name: "Signal Scorer", version: "1.8.0", type: "ensemble",
    status: "champion", features: ["feat_sma20", "feat_macd", "feat_volume", "feat_momentum", "feat_bb", "feat_trend"],
    datasetId: "ds_002", owner: "ml-team",
    metrics: { accuracy: 0.72, precision: 0.75, recall: 0.69, f1: 0.72, sharpe: 1.28, profitFactor: 1.48, maxDrawdown: -11.5, trainingLoss: 0.41, validationLoss: 0.44, overfitRatio: 1.07 },
    createdAt: now - 45 * 86400000, promotedAt: now - 35 * 86400000,
    hash: "sha256:f6e5d4c3b2a1", tags: ["production", "scoring"],
    parentVersion: "1.7.2",
  },
  {
    id: "mdl_003", name: "Entry Timing v3", version: "3.1.0", type: "hybrid",
    status: "shadow", features: ["feat_rsi14", "feat_price_change", "feat_vol20", "feat_sector_beta", "feat_news"],
    datasetId: "ds_003", owner: "quant-team",
    metrics: { accuracy: 0.68, precision: 0.71, recall: 0.65, f1: 0.68, sharpe: 1.15, profitFactor: 1.35, maxDrawdown: -14.2, trainingLoss: 0.48, validationLoss: 0.55, overfitRatio: 1.15 },
    createdAt: now - 10 * 86400000,
    hash: "sha256:1a2b3c4d5e6f", tags: ["shadow", "timing"],
    parentVersion: "3.0.2",
  },
  {
    id: "mdl_004", name: "Entry Timing v2", version: "3.0.2", type: "hybrid",
    status: "retired", features: ["feat_rsi14", "feat_price_change", "feat_vol20", "feat_sector_beta"],
    datasetId: "ds_001", owner: "quant-team",
    metrics: { accuracy: 0.64, precision: 0.67, recall: 0.61, f1: 0.64, sharpe: 0.95, profitFactor: 1.22, maxDrawdown: -16.8, trainingLoss: 0.52, validationLoss: 0.61, overfitRatio: 1.17 },
    createdAt: now - 90 * 86400000, retiredAt: now - 10 * 86400000,
    hash: "sha256:9z8y7x6w5v4u", tags: ["retired", "timing"],
  },
];

// ── Mock: Features ──────────────────────────────────────────────────────────

const FEATURES = [
  { id: "feat_sma20", name: "SMA 20-period", type: "numeric", source: "candles", version: "1.0", description: "Simple moving average (20 bars)", computeLatencyMs: 2, dependencies: [], usedByModels: ["mdl_001", "mdl_002"], status: "active" },
  { id: "feat_rsi14", name: "RSI 14-period", type: "numeric", source: "candles", version: "1.0", description: "Relative Strength Index", computeLatencyMs: 3, dependencies: [], usedByModels: ["mdl_001", "mdl_003", "mdl_004"], status: "active" },
  { id: "feat_macd", name: "MACD Signal", type: "numeric", source: "candles", version: "1.1", description: "MACD line and signal crossover", computeLatencyMs: 4, dependencies: ["feat_sma20"], usedByModels: ["mdl_002"], status: "active" },
  { id: "feat_volume", name: "Volume Ratio", type: "numeric", source: "candles", version: "1.0", description: "Current volume / 20-bar avg volume", computeLatencyMs: 2, dependencies: [], usedByModels: ["mdl_002"], status: "active" },
  { id: "feat_vol20", name: "Realized Vol 20d", type: "numeric", source: "candles", version: "1.0", description: "20-day realized volatility", computeLatencyMs: 5, dependencies: [], usedByModels: ["mdl_001", "mdl_003", "mdl_004"], status: "active" },
  { id: "feat_atr14", name: "ATR 14-period", type: "numeric", source: "candles", version: "1.0", description: "Average True Range", computeLatencyMs: 3, dependencies: [], usedByModels: ["mdl_001"], status: "active" },
  { id: "feat_bb", name: "Bollinger Band %B", type: "numeric", source: "candles", version: "1.0", description: "Position within Bollinger Bands", computeLatencyMs: 4, dependencies: ["feat_sma20"], usedByModels: ["mdl_002"], status: "active" },
  { id: "feat_momentum", name: "12-bar Momentum", type: "numeric", source: "candles", version: "1.0", description: "Price change over 12 bars", computeLatencyMs: 2, dependencies: [], usedByModels: ["mdl_002"], status: "active" },
  { id: "feat_price_change", name: "Price Change %", type: "numeric", source: "candles", version: "1.0", description: "1-bar % price change", computeLatencyMs: 1, dependencies: [], usedByModels: ["mdl_003", "mdl_004"], status: "active" },
  { id: "feat_regime", name: "Regime Label", type: "categorical", source: "regime_router", version: "2.0", description: "Current market regime (6 states)", computeLatencyMs: 15, dependencies: ["feat_vol20", "feat_atr14"], usedByModels: ["mdl_001"], status: "active" },
  { id: "feat_trend", name: "Trend Strength", type: "numeric", source: "candles", version: "1.0", description: "ADX-based trend strength 0-100", computeLatencyMs: 4, dependencies: [], usedByModels: ["mdl_002"], status: "active" },
  { id: "feat_sector_beta", name: "Sector Beta", type: "numeric", source: "portfolio", version: "1.0", description: "Beta to sector index", computeLatencyMs: 8, dependencies: [], usedByModels: ["mdl_003", "mdl_004"], status: "active" },
  { id: "feat_news", name: "News Sentiment", type: "numeric", source: "sentiment", version: "1.2", description: "Aggregated news sentiment score", computeLatencyMs: 25, dependencies: [], usedByModels: ["mdl_003"], status: "experimental" },
  { id: "feat_earnings", name: "Earnings Surprise", type: "numeric", source: "fundamentals", version: "1.0", description: "Last earnings beat/miss %", computeLatencyMs: 10, dependencies: [], usedByModels: [], status: "deprecated" },
  { id: "feat_flow", name: "Order Flow Delta", type: "numeric", source: "orderbook", version: "1.0", description: "Net buying pressure", computeLatencyMs: 5, dependencies: [], usedByModels: [], status: "active" },
];

// ── Mock: Datasets ──────────────────────────────────────────────────────────

const DATASETS = [
  { id: "ds_001", name: "Training Set 2023-2024", version: "3.0", source: "postgres", startDate: "2023-01-02", endDate: "2024-06-30", symbols: ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA", "SPY", "QQQ", "BTC/USD", "ETH/USD"], rowCount: 248500, featureCount: 15, splitRatio: { train: 0.7, val: 0.15, test: 0.15 }, hash: "sha256:ds001hash", transformations: ["normalize", "fill_missing", "remove_halts", "adjust_splits"] },
  { id: "ds_002", name: "Validation Set 2024 H1", version: "2.0", source: "postgres", startDate: "2024-01-02", endDate: "2024-06-30", symbols: ["AAPL", "MSFT", "GOOGL", "NVDA", "SPY", "QQQ"], rowCount: 152000, featureCount: 12, splitRatio: { train: 0, val: 1.0, test: 0 }, hash: "sha256:ds002hash", parentId: "ds_001", transformations: ["normalize", "fill_missing"] },
  { id: "ds_003", name: "Live Data 2024 H2+", version: "1.5", source: "streaming", startDate: "2024-07-01", endDate: "2025-12-31", symbols: ["AAPL", "MSFT", "GOOGL", "NVDA", "TSLA", "SPY", "QQQ", "BTC/USD", "ETH/USD", "SOL/USD"], rowCount: 512000, featureCount: 15, splitRatio: { train: 0, val: 0, test: 1.0 }, hash: "sha256:ds003hash", parentId: "ds_001", transformations: ["normalize", "fill_missing", "session_filter"] },
];

// ── Mock: Drift Reports ─────────────────────────────────────────────────────

const DRIFT = [
  {
    modelId: "mdl_001", modelName: "Regime Classifier", timestamp: now - 3600000,
    overallDrift: 0.12, driftLevel: "minor", recommendation: "maintain",
    checks: [
      { name: "Feature PSI", type: "feature", score: 0.08, threshold: 0.2, breached: false, detail: "All features stable (max PSI: 0.08 on vol20)", trend: "stable" },
      { name: "Prediction Drift", type: "prediction", score: 0.11, threshold: 0.25, breached: false, detail: "Output distribution stable", trend: "stable" },
      { name: "Performance Decay", type: "performance", score: 0.15, threshold: 0.3, breached: false, detail: "7d accuracy: 76% vs baseline 78%", trend: "stable" },
      { name: "Concept Drift", type: "data", score: 0.09, threshold: 0.2, breached: false, detail: "Feature-target relationship stable", trend: "stable" },
      { name: "Data Quality", type: "data", score: 0.05, threshold: 0.15, breached: false, detail: "No anomalies in input data", trend: "stable" },
      { name: "Regime Mismatch", type: "performance", score: 0.18, threshold: 0.3, breached: false, detail: "Current regime: range (trained on all)", trend: "increasing" },
    ],
    history: Array.from({ length: 30 }, (_, i) => ({ day: 30 - i, score: 0.08 + Math.random() * 0.08 })),
  },
  {
    modelId: "mdl_002", modelName: "Signal Scorer", timestamp: now - 3600000,
    overallDrift: 0.38, driftLevel: "moderate", recommendation: "retrain",
    checks: [
      { name: "Feature PSI", type: "feature", score: 0.22, threshold: 0.2, breached: true, detail: "PSI breach on momentum (0.22) and volume (0.21)", trend: "increasing" },
      { name: "Prediction Drift", type: "prediction", score: 0.31, threshold: 0.25, breached: true, detail: "Output skewing bearish vs training", trend: "increasing" },
      { name: "Performance Decay", type: "performance", score: 0.35, threshold: 0.3, breached: true, detail: "7d accuracy: 64% vs baseline 72% — declining", trend: "increasing" },
      { name: "Concept Drift", type: "data", score: 0.28, threshold: 0.2, breached: true, detail: "Feature-target correlation weakening", trend: "increasing" },
      { name: "Data Quality", type: "data", score: 0.10, threshold: 0.15, breached: false, detail: "Input data clean", trend: "stable" },
      { name: "Regime Mismatch", type: "performance", score: 0.42, threshold: 0.3, breached: true, detail: "Trained mostly on trend_up, current: range", trend: "increasing" },
    ],
    history: Array.from({ length: 30 }, (_, i) => ({ day: 30 - i, score: 0.15 + (i / 30) * 0.25 + Math.random() * 0.05 })),
    autoAction: "Retrain scheduled for 2026-04-13",
  },
  {
    modelId: "mdl_003", modelName: "Entry Timing v3", timestamp: now - 3600000,
    overallDrift: 0.05, driftLevel: "none", recommendation: "maintain",
    checks: [
      { name: "Feature PSI", type: "feature", score: 0.03, threshold: 0.2, breached: false, detail: "All features within normal range", trend: "stable" },
      { name: "Prediction Drift", type: "prediction", score: 0.05, threshold: 0.25, breached: false, detail: "Shadow mode — output distribution normal", trend: "stable" },
      { name: "Performance Decay", type: "performance", score: 0.04, threshold: 0.3, breached: false, detail: "Shadow accuracy: 68% (baseline)", trend: "stable" },
      { name: "Concept Drift", type: "data", score: 0.06, threshold: 0.2, breached: false, detail: "Feature relationships stable", trend: "stable" },
      { name: "Data Quality", type: "data", score: 0.02, threshold: 0.15, breached: false, detail: "Clean inputs", trend: "stable" },
      { name: "Regime Mismatch", type: "performance", score: 0.08, threshold: 0.3, breached: false, detail: "Trained on multiple regimes", trend: "stable" },
    ],
    history: Array.from({ length: 10 }, (_, i) => ({ day: 10 - i, score: 0.03 + Math.random() * 0.04 })),
  },
];

// ── Mock: Shadow Deployments ────────────────────────────────────────────────

const SHADOWS = [
  {
    id: "shadow_001", challengerModelId: "mdl_003", challengerName: "Entry Timing v3",
    championModelId: "mdl_004", championName: "Entry Timing v2",
    startedAt: now - 15 * 86400000, minDurationDays: 21, status: "active",
    comparison: {
      totalPredictions: 1850, championAccuracy: 0.64, challengerAccuracy: 0.68,
      championSharpe: 0.95, challengerSharpe: 1.15, championPF: 1.22, challengerPF: 1.35,
      winRateDelta: 4.0, sharpeDelta: 0.20, pValue: 0.031, significant: true,
      daysRunning: 15, daysRemaining: 6,
    },
    promotionReady: false,
    promotionBlockers: ["Minimum 21-day shadow period not met (15/21 days)"],
  },
  {
    id: "shadow_002", challengerModelId: "mdl_001", challengerName: "Regime Classifier v2.3",
    championModelId: "mdl_old_regime", championName: "Regime Classifier v2.2",
    startedAt: now - 45 * 86400000, minDurationDays: 14, status: "promoted",
    comparison: {
      totalPredictions: 5200, championAccuracy: 0.73, challengerAccuracy: 0.78,
      championSharpe: 1.28, challengerSharpe: 1.45, championPF: 1.48, challengerPF: 1.62,
      winRateDelta: 5.0, sharpeDelta: 0.17, pValue: 0.008, significant: true,
      daysRunning: 30, daysRemaining: 0,
    },
    promotionReady: true, promotionBlockers: [],
  },
];

// ── Mock: Governance Timeline ───────────────────────────────────────────────

const TIMELINE = [
  { id: "evt_01", type: "promotion", modelName: "Regime Classifier", version: "2.3.1", timestamp: now - 21 * 86400000, detail: "Promoted from shadow after 30-day trial. Accuracy +5%, Sharpe +0.17." },
  { id: "evt_02", type: "retirement", modelName: "Entry Timing v2", version: "3.0.2", timestamp: now - 10 * 86400000, detail: "Retired after v3 entered shadow. Performance declining." },
  { id: "evt_03", type: "shadow_start", modelName: "Entry Timing v3", version: "3.1.0", timestamp: now - 15 * 86400000, detail: "Shadow deployment started vs Entry Timing v2." },
  { id: "evt_04", type: "drift_alert", modelName: "Signal Scorer", version: "1.8.0", timestamp: now - 5 * 86400000, detail: "Moderate drift detected. Retrain scheduled for Apr 13." },
  { id: "evt_05", type: "retrain", modelName: "Signal Scorer", version: "1.8.0", timestamp: now - 48 * 86400000, detail: "Retrained on extended dataset (ds_003). Accuracy improved 3%." },
  { id: "evt_06", type: "feature_added", modelName: "Entry Timing v3", version: "3.1.0", timestamp: now - 12 * 86400000, detail: "Added news sentiment feature (experimental)." },
  { id: "evt_07", type: "rollback", modelName: "Signal Scorer", version: "1.7.0→1.7.2", timestamp: now - 60 * 86400000, detail: "Rolled back from 1.7.0 to 1.7.2 after critical drift detected." },
];

// ── Routes ──────────────────────────────────────────────────────────────────

router.get("/models", (_req: Request, res: Response) => {
  const champions = MODELS.filter(m => m.status === "champion");
  const shadows = MODELS.filter(m => m.status === "shadow");
  res.json({ models: MODELS, total: MODELS.length, champions: champions.length, shadows: shadows.length });
});

router.get("/features", (_req: Request, res: Response) => {
  const active = FEATURES.filter(f => f.status === "active");
  res.json({ features: FEATURES, total: FEATURES.length, active: active.length });
});

router.get("/datasets", (_req: Request, res: Response) => {
  res.json({ datasets: DATASETS, total: DATASETS.length });
});

router.get("/drift", (_req: Request, res: Response) => {
  const drifting = DRIFT.filter(d => d.driftLevel !== "none" && d.driftLevel !== "minor");
  res.json({ reports: DRIFT, driftingModels: drifting.length, totalModels: DRIFT.length });
});

router.get("/shadows", (_req: Request, res: Response) => {
  const active = SHADOWS.filter(s => s.status === "active");
  res.json({ deployments: SHADOWS, active: active.length, total: SHADOWS.length });
});

router.get("/timeline", (_req: Request, res: Response) => {
  res.json({ events: TIMELINE, total: TIMELINE.length });
});

router.get("/health", (_req: Request, res: Response) => {
  res.json({
    status: "operational", module: "model-governance", phase: 113,
    registeredModels: MODELS.length, champions: MODELS.filter(m => m.status === "champion").length,
    activeShadows: SHADOWS.filter(s => s.status === "active").length,
    driftingModels: DRIFT.filter(d => d.driftLevel !== "none" && d.driftLevel !== "minor").length,
    uptime: process.uptime(), timestamp: Date.now(),
  });
});

export default router;
