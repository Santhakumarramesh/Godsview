/**
 * strategy_cache.ts — Live Strategy Computation Cache
 *
 * Periodically fetches bars from Alpaca and runs the REAL strategy engine
 * (regime detection, SK features, CVD features, indicator features, OB detection,
 * setup scanning) so that the /api/system/status endpoint returns accurate,
 * computed values instead of heuristic placeholders.
 *
 * Cache TTL: 30s (matches dashboard refresh). Bars are fetched on-demand
 * with a staleness guard so we never hammer Alpaca.
 */

import { getBars } from "./alpaca";
import type { AlpacaBar } from "./alpaca";
import {
  buildRecallFeatures,
  detectRegime,
  computeSKFeatures,
  computeCVDFeatures,
  computeFinalQuality,
  scoreRecall,
  getQualityThreshold,
  applyNoTradeFilters,
  detectAbsorptionReversal,
  detectSweepReclaim,
  detectContinuationPullback,
  detectCVDDivergence,
  detectBreakoutFailure,
  type RecallFeatures,
  type Regime,
  type SKFeatures,
  type CVDFeatures,
  type IndicatorFeatures,
  type SetupType,
  type SetupCandidate,
} from "./strategy_engine";

// ── Types ────────────────────────────────────────────────────────────────────

export type LiveStrategySnapshot = {
  computed_at: string;
  symbol: string;
  bars_1m: number;
  bars_5m: number;

  // Core metrics (what the dashboard overlay cards display)
  regime: Regime;
  regime_label: string;
  regime_confidence: number; // 0–100

  c4_score: number;         // 0–100 composite confidence
  c4_breakdown: {
    structure_avg: number;
    order_flow_avg: number;
    recall_avg: number;
    indicator_confidence: number;
    trend_consensus: number;
    flow_alignment: number;
  };

  active_obs: number;
  ob_zones: Array<{
    side: "bullish" | "bearish";
    low: number;
    high: number;
    strength: number;
  }>;

  sk_quality: string;       // "Strong" | "Moderate" | "Weak"
  sk_score: number;         // 0–1 raw sequence_score
  sk: SKFeatures;

  position_bias: string;    // "Long" | "Short" | "Neutral"
  bias_confidence: number;  // 0–100

  // Detailed features for advanced overlay
  cvd: CVDFeatures;
  indicators: IndicatorFeatures;
  recall: RecallFeatures | null;

  // Detected setups
  detected_setups: Array<{
    type: SetupType;
    direction: "long" | "short";
    quality: number;
    threshold: number;
    meets_threshold: boolean;
    structure: number;
    order_flow: number;
  }>;
  blocked_setups: Array<{ type: SetupType; reason: string }>;

  // Chart overlay levels
  swing_high: number;
  swing_low: number;
  last_close: number;
  atr_pct: number;

  // Error state
  error: string | null;
};

// ── Cache State ──────────────────────────────────────────────────────────────

const CACHE_TTL = 30_000; // 30 seconds
let _cache: LiveStrategySnapshot | null = null;
let _cacheTs = 0;
let _computing = false;

// ── Order Block Detection (simplified, matching alpaca.ts logic) ─────────────

function detectOrderBlocks(bars: AlpacaBar[]): LiveStrategySnapshot["ob_zones"] {
  if (bars.length < 8) return [];

  const avgVol = bars.reduce((s, b) => s + b.Volume, 0) / bars.length;
  const blocks: LiveStrategySnapshot["ob_zones"] = [];

  for (let i = 2; i < bars.length - 2; i++) {
    const bar = bars[i];
    const next = bars[i + 1];
    const next2 = bars[i + 2];

    const barRange = Math.max(bar.High - bar.Low, 0.000001);
    const bodySize = Math.abs(bar.Close - bar.Open);
    const bodyRatio = bodySize / barRange;
    const volStrength = avgVol > 0 ? bar.Volume / avgVol : 1;

    const isBullish =
      bar.Close < bar.Open &&
      next.Close > next.Open &&
      next2.Close > next2.Open &&
      bodyRatio > 0.5 &&
      volStrength > 1.2;

    const isBearish =
      bar.Close > bar.Open &&
      next.Close < next.Open &&
      next2.Close < next2.Open &&
      bodyRatio > 0.5 &&
      volStrength > 1.2;

    if (isBullish || isBearish) {
      const lastClose = bars[bars.length - 1].Close;
      const zone = { low: bar.Low, high: bar.High, mid: (bar.Low + bar.High) / 2 };

      // Only include OBs that haven't been fully mitigated (price hasn't swept through)
      const mitigated = isBullish
        ? lastClose < zone.low * 0.998
        : lastClose > zone.high * 1.002;

      if (!mitigated) {
        blocks.push({
          side: isBullish ? "bullish" : "bearish",
          low: zone.low,
          high: zone.high,
          strength: Math.min(volStrength / 2, 1),
        });
      }
    }
  }

  // Sort by strength descending, keep top 10
  return blocks.sort((a, b) => b.strength - a.strength).slice(0, 10);
}

// ── Regime Confidence ────────────────────────────────────────────────────────

function computeRegimeConfidence(bars: AlpacaBar[], regime: Regime): number {
  if (bars.length < 20) return 30;

  const last20 = bars.slice(-20);
  const closes = last20.map(b => b.Close).filter(Number.isFinite);
  if (closes.length < 10) return 30;

  const mean = closes.reduce((s, c) => s + c, 0) / closes.length;
  const variance = closes.reduce((s, c) => s + (c - mean) ** 2, 0) / closes.length;
  const stdev = Math.sqrt(Math.max(variance, 0));
  const cv = mean > 0 ? stdev / mean : 0; // coefficient of variation

  const directionMatches = last20.filter(b =>
    (regime === "trending_bull" && b.Close > b.Open) ||
    (regime === "trending_bear" && b.Close < b.Open) ||
    (regime === "ranging" && Math.abs(b.Close - b.Open) < (b.High - b.Low) * 0.4)
  ).length;
  const persistence = directionMatches / last20.length;

  // Base confidence from persistence
  let conf = persistence * 60;

  // Boost for trending: low CV + high persistence
  if (regime === "trending_bull" || regime === "trending_bear") {
    conf += (1 - Math.min(cv * 20, 1)) * 20;
    conf += persistence > 0.6 ? 15 : persistence > 0.5 ? 8 : 0;
  }
  // Boost for ranging: low CV + mixed direction
  else if (regime === "ranging") {
    const rangePersistence = 1 - Math.abs(persistence - 0.5) * 2;
    conf += rangePersistence * 25;
    if (cv < 0.015) conf += 15;
  }
  // Volatile: high CV
  else if (regime === "volatile") {
    conf += Math.min(cv * 500, 30);
  }

  return Math.round(Math.max(30, Math.min(100, conf)));
}

// ── Bias Computation ─────────────────────────────────────────────────────────

function computeBias(
  recall: RecallFeatures | null,
  sk: SKFeatures,
  cvd: CVDFeatures,
  indicators: IndicatorFeatures
): { label: string; confidence: number } {
  let bullPoints = 0;
  let bearPoints = 0;

  // SK bias (weight: 3)
  if (sk.bias === "bull") bullPoints += 3;
  else if (sk.bias === "bear") bearPoints += 3;

  // CVD slope (weight: 2)
  if (cvd.cvd_slope > 0.001) bullPoints += 2;
  else if (cvd.cvd_slope < -0.001) bearPoints += 2;

  // Buy volume ratio (weight: 1.5)
  if (cvd.buy_volume_ratio > 0.55) bullPoints += 1.5;
  else if (cvd.buy_volume_ratio < 0.45) bearPoints += 1.5;

  // Indicator bias (weight: 2)
  if (indicators.indicator_bias === "bull") bullPoints += 2;
  else if (indicators.indicator_bias === "bear") bearPoints += 2;

  // RSI (weight: 1)
  if (indicators.rsi_14 > 55) bullPoints += 1;
  else if (indicators.rsi_14 < 45) bearPoints += 1;

  // MACD histogram (weight: 1.5)
  if (indicators.macd_hist > 0) bullPoints += 1.5;
  else if (indicators.macd_hist < 0) bearPoints += 1.5;

  // EMA spread (weight: 1)
  if (indicators.ema_spread_pct > 0) bullPoints += 1;
  else if (indicators.ema_spread_pct < 0) bearPoints += 1;

  // Recall trend consensus (weight: 2)
  if (recall) {
    if (recall.trend_slope_5m > 0.002) bullPoints += 2;
    else if (recall.trend_slope_5m < -0.002) bearPoints += 2;

    if (recall.flow_alignment > 0.6) {
      // Amplify the winning side
      if (bullPoints > bearPoints) bullPoints += 1;
      else bearPoints += 1;
    }
  }

  const total = bullPoints + bearPoints;
  const diff = Math.abs(bullPoints - bearPoints);
  const confidence = total > 0 ? Math.round((diff / total) * 100) : 0;

  if (bullPoints > bearPoints + 2) return { label: "Long", confidence: Math.min(confidence + 20, 100) };
  if (bearPoints > bullPoints + 2) return { label: "Short", confidence: Math.min(confidence + 20, 100) };
  return { label: "Neutral", confidence: Math.max(30, 100 - confidence) };
}

// ── C4 Composite Score ───────────────────────────────────────────────────────

function computeC4Score(
  recall: RecallFeatures | null,
  sk: SKFeatures,
  cvd: CVDFeatures,
  indicators: IndicatorFeatures,
  regimeConf: number,
  detectedSetups: LiveStrategySnapshot["detected_setups"]
): { score: number; breakdown: LiveStrategySnapshot["c4_breakdown"] } {
  // C4 = Composite 4-Layer Confidence
  // Structure (25%) + Order Flow (25%) + Recall (25%) + Indicators (25%)

  // Structure component: SK sequence quality + regime confidence
  const structureScore = (sk.sequence_score * 0.6 + (regimeConf / 100) * 0.4);

  // Order flow component: CVD health + volume ratio quality
  const cvdHealth = Math.abs(cvd.cvd_slope) > 0.001 ? 0.7 : 0.4;
  const volBalance = 1 - Math.abs(cvd.buy_volume_ratio - 0.5) * 2; // 0 = extreme, 1 = balanced
  const orderFlowScore = cvd.cvd_value !== 0
    ? (cvdHealth * 0.6 + (1 - volBalance) * 0.4) // want conviction, not balance
    : 0.3;

  // Recall component: trend consensus + flow alignment
  const recallScore = recall
    ? (recall.trend_consensus * 0.4 + recall.flow_alignment * 0.3 + (1 - recall.fake_entry_risk) * 0.3)
    : 0.4;

  // Indicator component
  const rsiStrength = Math.abs(indicators.rsi_14 - 50) / 50;
  const macdStrength = indicators.macd_hist !== 0 ? 0.6 : 0.3;
  const emaStrength = Math.abs(indicators.ema_spread_pct) > 0.001 ? 0.7 : 0.3;
  const indicatorScore = (rsiStrength * 0.35 + macdStrength * 0.35 + emaStrength * 0.3);

  // Weighted composite
  let c4 = structureScore * 0.25 + orderFlowScore * 0.25 + recallScore * 0.25 + indicatorScore * 0.25;

  // Setup detection bonus: if we found quality setups, boost confidence
  const qualitySetups = detectedSetups.filter(s => s.meets_threshold);
  if (qualitySetups.length > 0) {
    const bestQuality = Math.max(...qualitySetups.map(s => s.quality));
    c4 = c4 * 0.7 + bestQuality * 0.3; // blend with best setup quality
  }

  // Scale to 0-100
  const score = Math.round(Math.max(0, Math.min(100, c4 * 100)));

  return {
    score,
    breakdown: {
      structure_avg: Math.round(structureScore * 100) / 100,
      order_flow_avg: Math.round(orderFlowScore * 100) / 100,
      recall_avg: Math.round(recallScore * 100) / 100,
      indicator_confidence: Math.round(indicatorScore * 100) / 100,
      trend_consensus: recall?.trend_consensus ?? 0,
      flow_alignment: recall?.flow_alignment ?? 0,
    },
  };
}

// ── SK Quality Label ─────────────────────────────────────────────────────────

function skQualityLabel(sk: SKFeatures): string {
  const score = sk.sequence_score;
  if (score >= 0.65 && sk.in_zone && sk.correction_complete) return "Strong";
  if (score >= 0.45 || (sk.in_zone && score >= 0.3)) return "Moderate";
  return "Weak";
}

// ── Main Computation ─────────────────────────────────────────────────────────

async function computeSnapshot(symbol: string): Promise<LiveStrategySnapshot> {
  const now = new Date().toISOString();
  const errorResult = (error: string): LiveStrategySnapshot => ({
    computed_at: now,
    symbol,
    bars_1m: 0,
    bars_5m: 0,
    regime: "ranging",
    regime_label: "Ranging",
    regime_confidence: 0,
    c4_score: 0,
    c4_breakdown: { structure_avg: 0, order_flow_avg: 0, recall_avg: 0, indicator_confidence: 0, trend_consensus: 0, flow_alignment: 0 },
    active_obs: 0,
    ob_zones: [],
    sk_quality: "—",
    sk_score: 0,
    sk: { bias: "neutral", sequence_stage: "none", correction_complete: false, zone_distance_pct: 1, swing_high: 0, swing_low: 0, impulse_strength: 0, sequence_score: 0, rr_quality: 0, in_zone: false },
    position_bias: "—",
    bias_confidence: 0,
    cvd: { cvd_value: 0, cvd_slope: 0, cvd_divergence: false, buy_volume_ratio: 0.5, delta_momentum: 0, large_delta_bar: false },
    indicators: { rsi_14: 50, macd_line: 0, macd_signal: 0, macd_hist: 0, ema_fast: 0, ema_slow: 0, ema_spread_pct: 0, bb_width: 0, bb_position: 0.5, indicator_bias: "neutral" },
    recall: null,
    detected_setups: [],
    blocked_setups: [],
    swing_high: 0,
    swing_low: 0,
    last_close: 0,
    atr_pct: 0,
    error,
  });

  try {
    // Fetch bars — same depths as the live scan endpoint
    const [bars1m, bars5m] = await Promise.all([
      getBars(symbol, "1Min", 200).catch(() => [] as AlpacaBar[]),
      getBars(symbol, "5Min", 100).catch(() => [] as AlpacaBar[]),
    ]);

    if (bars1m.length < 20) {
      return errorResult(`Insufficient data: only ${bars1m.length} 1m bars (need 20+)`);
    }

    // ── Run the REAL strategy engine ──────────────────────────────────────
    const recall = buildRecallFeatures(bars1m, bars5m, []);
    const regime = recall.regime;
    const sk = recall.sk;
    const cvd = recall.cvd;
    const indicators = recall.indicators;

    const lastBar = bars1m[bars1m.length - 1];
    const lastClose = lastBar.Close;

    // Regime confidence
    const regimeConf = computeRegimeConfidence(bars1m, regime);

    // Order blocks
    const obZones = detectOrderBlocks(bars1m);

    // Run all 5 setup detectors
    const setupTypes: SetupType[] = [
      "absorption_reversal",
      "sweep_reclaim",
      "continuation_pullback",
      "cvd_divergence",
      "breakout_failure",
    ];

    const detectedSetups: LiveStrategySnapshot["detected_setups"] = [];
    const blockedSetups: LiveStrategySnapshot["blocked_setups"] = [];

    for (const setupType of setupTypes) {
      const noTrade = applyNoTradeFilters(bars1m, recall, setupType, {});
      if (noTrade.blocked) {
        blockedSetups.push({ type: setupType, reason: noTrade.reason });
        continue;
      }

      let result: { detected: boolean; direction: "long" | "short"; structure: number; orderFlow: number };
      switch (setupType) {
        case "absorption_reversal":
          result = detectAbsorptionReversal(bars1m, bars5m, recall);
          break;
        case "sweep_reclaim":
          result = detectSweepReclaim(bars1m, bars5m, recall);
          break;
        case "cvd_divergence":
          result = detectCVDDivergence(bars1m, bars5m, recall);
          break;
        case "breakout_failure":
          result = detectBreakoutFailure(bars1m, bars5m, recall);
          break;
        default:
          result = detectContinuationPullback(bars1m, bars5m, recall);
      }

      if (!result.detected) continue;

      const recallScore = scoreRecall(recall, setupType, result.direction);
      const quality = computeFinalQuality(result.structure, result.orderFlow, recallScore, {
        recall,
        direction: result.direction,
      });
      const threshold = getQualityThreshold(regime, setupType);

      detectedSetups.push({
        type: setupType,
        direction: result.direction,
        quality: Math.round(quality * 100) / 100,
        threshold: Math.round(threshold * 100) / 100,
        meets_threshold: quality >= threshold,
        structure: Math.round(result.structure * 100) / 100,
        order_flow: Math.round(result.orderFlow * 100) / 100,
      });
    }

    // C4 composite score
    const { score: c4Score, breakdown: c4Breakdown } = computeC4Score(
      recall, sk, cvd, indicators, regimeConf, detectedSetups
    );

    // Bias
    const bias = computeBias(recall, sk, cvd, indicators);

    // Regime label
    const regimeLabels: Record<Regime, string> = {
      trending_bull: "Trending Bull",
      trending_bear: "Trending Bear",
      ranging: "Ranging",
      volatile: "Volatile",
      chop: "Chop",
    };

    return {
      computed_at: now,
      symbol,
      bars_1m: bars1m.length,
      bars_5m: bars5m.length,
      regime,
      regime_label: regimeLabels[regime] ?? "Ranging",
      regime_confidence: regimeConf,
      c4_score: c4Score,
      c4_breakdown: c4Breakdown,
      active_obs: obZones.length,
      ob_zones: obZones,
      sk_quality: skQualityLabel(sk),
      sk_score: Math.round(sk.sequence_score * 1000) / 1000,
      sk,
      position_bias: bias.label,
      bias_confidence: bias.confidence,
      cvd,
      indicators,
      recall,
      detected_setups: detectedSetups,
      blocked_setups: blockedSetups,
      swing_high: sk.swing_high,
      swing_low: sk.swing_low,
      last_close: lastClose,
      atr_pct: recall.atr_pct,
      error: null,
    };
  } catch (err) {
    return errorResult(String(err));
  }
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Get the latest strategy snapshot. Returns cached result if fresh,
 * otherwise triggers a new computation.
 */
export async function getStrategySnapshot(symbol = "BTC/USD"): Promise<LiveStrategySnapshot> {
  const now = Date.now();

  // Return cache if fresh
  if (_cache && now - _cacheTs < CACHE_TTL && _cache.symbol === symbol) {
    return _cache;
  }

  // If already computing, return stale cache or empty
  if (_computing) {
    return _cache ?? await computeSnapshot(symbol);
  }

  _computing = true;
  try {
    _cache = await computeSnapshot(symbol);
    _cacheTs = Date.now();
    return _cache;
  } finally {
    _computing = false;
  }
}

/**
 * Force recompute (e.g., after a scan or trade event).
 */
export async function refreshStrategyCache(symbol = "BTC/USD"): Promise<LiveStrategySnapshot> {
  _cacheTs = 0;
  return getStrategySnapshot(symbol);
}

/**
 * Get the quick overlay data for the system status endpoint.
 * This is a subset of the full snapshot, formatted for the dashboard cards.
 */
export async function getStrategyOverlay(symbol = "BTC/USD"): Promise<{
  regime: string;
  regime_confidence: number;
  c4_score: number;
  active_obs: number;
  sk_quality: string;
  sk_score: number;
  position_bias: string;
  bias_confidence: number;
  last_setup: string | null;
  last_setup_direction: string | null;
  error: string | null;
}> {
  const snap = await getStrategySnapshot(symbol);
  const lastSetup = snap.detected_setups.length > 0 ? snap.detected_setups[0] : null;

  return {
    regime: snap.regime_label,
    regime_confidence: snap.regime_confidence,
    c4_score: snap.c4_score,
    active_obs: snap.active_obs,
    sk_quality: snap.sk_quality,
    sk_score: snap.sk_score,
    position_bias: snap.position_bias,
    bias_confidence: snap.bias_confidence,
    last_setup: lastSetup?.type ?? null,
    last_setup_direction: lastSetup?.direction ?? null,
    error: snap.error,
  };
}
