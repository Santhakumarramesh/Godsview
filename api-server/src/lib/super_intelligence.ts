/**
 * Super Intelligence Module — Maximum Win Rate & Profit Engine
 *
 * Upgrades the pipeline from basic scoring to an adaptive system that:
 * 1. Ensemble ML: Gradient-boosted trees + logistic regression voting
 * 2. Kelly Criterion: Mathematically optimal position sizing
 * 3. Regime-Adaptive Weights: Dynamic Q formula per market condition
 * 4. Multi-Timeframe Confluence: Requires alignment across 1m/5m/15m
 * 5. Trailing Stop Engine: Dynamic exits that lock in profit
 *
 * The goal: turn a 55-60% win rate into 65-75%+ while maximizing
 * profit per winning trade via optimal sizing and exits.
 */

import { predictWinProbability, getModelStatus } from "./ml_model";
import { reasonTradeDecision } from "./reasoning_engine";
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface SuperSignal {
  /** Original pipeline quality (0-1) */
  base_quality: number;
  /** Enhanced quality after super intelligence (0-1) */
  enhanced_quality: number;
  /** Win probability from ensemble model (0-1) */
  win_probability: number;
  /** Confidence-weighted position size (fraction of equity) */
  kelly_fraction: number;
  /** Suggested quantity (units) */
  suggested_qty: number;
  /** Regime-adaptive pipeline weights used */
  regime_weights: RegimeWeights;
  /** Multi-timeframe confluence score (0-1) */
  confluence_score: number;
  /** Number of aligned timeframes (out of 3) */
  aligned_timeframes: number;
  /** Trailing stop parameters */
  trailing_stop: TrailingStopConfig;
  /** Partial profit targets */
  profit_targets: ProfitTarget[];
  /** Whether signal passes super intelligence filter */
  approved: boolean;
  /** Rejection reason if not approved */
  rejection_reason?: string;
  /** Edge score: expected value per dollar risked */
  edge_score: number;
}

export interface RegimeWeights {
  structure: number;
  order_flow: number;
  recall: number;
  ml: number;
  claude: number;
  label: string;
}

export interface TrailingStopConfig {
  /** Initial stop distance as ATR multiple */
  initial_atr_multiple: number;
  /** Trailing activation: move stop to breakeven after this ATR move */
  activation_atr: number;
  /** Trail step: move stop by this fraction of favorable move */
  trail_step: number;
  /** Time-based exit: close after N minutes if flat */
  max_hold_minutes: number;
}

export interface ProfitTarget {
  /** Fraction of position to close */
  close_pct: number;
  /** R-multiple target (e.g., 1.5 = 1.5× risk) */
  r_target: number;
}

export interface SuperIntelligenceInput {
  structure_score: number;
  order_flow_score: number;
  recall_score: number;
  setup_type: string;
  regime: string;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  atr: number;
  equity: number;
  /** Multi-timeframe signals: { "1m": score, "5m": score, "15m": score } */
  timeframe_scores?: Record<string, number>;
}

// ── 1. Regime-Adaptive Pipeline Weights ─────────────────────────────────────
// Different market conditions demand different layer emphasis.
// Trending: trust structure + ML. Ranging: trust order flow + recall.
// Volatile: require ALL layers strong. Chop: don't trade.

const REGIME_WEIGHTS: Record<string, RegimeWeights> = {
  trending_bull: {
    structure: 0.35, order_flow: 0.22, recall: 0.18, ml: 0.15, claude: 0.10,
    label: "Trend-Following (Bull)",
  },
  trending_bear: {
    structure: 0.35, order_flow: 0.22, recall: 0.18, ml: 0.15, claude: 0.10,
    label: "Trend-Following (Bear)",
  },
  ranging: {
    structure: 0.25, order_flow: 0.30, recall: 0.22, ml: 0.13, claude: 0.10,
    label: "Mean-Reversion (Range)",
  },
  volatile: {
    structure: 0.28, order_flow: 0.28, recall: 0.20, ml: 0.12, claude: 0.12,
    label: "High-Conviction Only (Volatile)",
  },
  chop: {
    structure: 0.20, order_flow: 0.20, recall: 0.20, ml: 0.20, claude: 0.20,
    label: "All-Layer Consensus (Chop)",
  },
};

function getRegimeWeights(regime: string): RegimeWeights {
  return REGIME_WEIGHTS[regime] ?? REGIME_WEIGHTS.ranging;
}

// ── 1.5 Trading Strategies: Professional Trading Setups ──────────────────────
// Well-known strategies from professional traders and institutions.
// Each strategy includes entry rules, exit rules, optimal regimes, and accuracy ratings.

export interface TradingStrategy {
  name: string;
  description: string;
  type: "scalp" | "swing" | "position" | "day";
  timeframes: string[];
  indicators: string[];
  entry_rules: string[];
  exit_rules: string[];
  risk_reward_min: number;
  best_regimes: string[];
  youtube_reference?: string;
  accuracy_rating: number; // 1-5 stars
}

export const TRADING_STRATEGIES: TradingStrategy[] = [
  {
    name: "SMC - Order Blocks",
    description: "Smart Money Concepts using order blocks and fair value gaps for institutional entry points",
    type: "swing",
    timeframes: ["15m", "1h", "4h"],
    indicators: ["Volume Profile", "Order Block", "Fair Value Gap", "Liquidity Levels"],
    entry_rules: [
      "Identify order block from previous strong move (2-4 candles)",
      "Wait for pullback and retest of order block",
      "Enter on break of order block boundary with volume confirmation",
      "Risk at break of fair value gap"
    ],
    exit_rules: [
      "Take profit at next liquidity level or resistance",
      "Trail stop above order block as price progresses",
      "Exit on break of entry candle low (swing low invalidation)"
    ],
    risk_reward_min: 1.5,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 4.5,
  },
  {
    name: "ICT - Optimal Trade Entry",
    description: "Inner Circle Trader method: kill zones, daily bias, and optimal entries at market structure breaks",
    type: "scalp",
    timeframes: ["5m", "15m"],
    indicators: ["Daily Bias", "Displacement", "Kill Zone (NY Open, London Close)", "Breaker Blocks"],
    entry_rules: [
      "Trade during NY/London kill zone (10 minutes after open)",
      "Only trade in direction of daily bias (HTF trend)",
      "Enter on break of overnight high/low with acceleration",
      "Scalp from mid-candle moves within kill zone"
    ],
    exit_rules: [
      "Exit on first liquidity grab (countertrend spike)",
      "Trail profit at each new high/low (scalp style)",
      "Cut losses at 3-5 pips if breaker block fails"
    ],
    risk_reward_min: 1.0,
    best_regimes: ["volatile", "ranging"],
    accuracy_rating: 4.0,
  },
  {
    name: "Wyckoff Method - Accumulation Phase",
    description: "Accumulation and distribution phases detecting smart money positioning and spring setups",
    type: "position",
    timeframes: ["1h", "4h", "1d"],
    indicators: ["Volume Analysis", "Price Action Structure", "Spring/Upthrust", "Effort vs Result"],
    entry_rules: [
      "Identify accumulation phase: declining volume on down moves",
      "Spot spring: break of support, immediate recovery above",
      "Wait for test and rejection of accumulation high",
      "Enter on break of accumulation range with volume"
    ],
    exit_rules: [
      "Exit when distribution phase begins (volume increases on up moves)",
      "Trail stop at each support level breakthrough",
      "Take profit at logical resistance or ATR target"
    ],
    risk_reward_min: 2.0,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 4.2,
  },
  {
    name: "Supply & Demand Zones",
    description: "Trading fresh and tested supply/demand zones with flip zone confirmation",
    type: "swing",
    timeframes: ["15m", "1h", "4h"],
    indicators: ["Supply Level", "Demand Level", "Zone Confluence", "Rejection Candles"],
    entry_rules: [
      "Mark supply/demand zones from clean 2-candle reversals",
      "Differentiate: fresh zone (not touched), tested zone (1-2 tests), flip zone (broken and reclaimed)",
      "Enter fresh zone on approach with volume confirmation",
      "Flip zones offer lower-risk entries after confirmation"
    ],
    exit_rules: [
      "Exit at next opposite zone (supply below, demand above)",
      "Trail stop at previous zone once price clears it",
      "Hard stop at break of zone candle for tight risk"
    ],
    risk_reward_min: 1.5,
    best_regimes: ["ranging", "trending_bull", "trending_bear"],
    accuracy_rating: 4.1,
  },
  {
    name: "Break & Retest Strategy",
    description: "Breakout confirmation with pullback retest entries for high-probability setups",
    type: "swing",
    timeframes: ["1h", "4h"],
    indicators: ["Support/Resistance", "Volume Breakout", "Retracement Levels", "Structure Break"],
    entry_rules: [
      "Identify strong support/resistance (3+ tests or clean reversal)",
      "Wait for strong breakout (close beyond level with volume)",
      "Pullback should retest broken level or 50% retracement",
      "Enter on reversal from retest with momentum divergence"
    ],
    exit_rules: [
      "Exit at next logical resistance/support",
      "Trail stop above entry level after initial profit",
      "Cut loss at break of retest candle (entry bar low)"
    ],
    risk_reward_min: 2.0,
    best_regimes: ["trending_bull", "trending_bear", "volatile"],
    accuracy_rating: 4.3,
  },
  {
    name: "Fibonacci Retracement Trades",
    description: "Golden ratio entries at 0.618 and 0.786 retracements with structure confluence",
    type: "swing",
    timeframes: ["1h", "4h", "1d"],
    indicators: ["Fibonacci Retracement", "Swing Highs/Lows", "Volume Profile", "Structure"],
    entry_rules: [
      "Draw fib from latest swing high to swing low (or vice versa)",
      "Key levels: 0.618 (golden ratio), 0.786 (natural support)",
      "Enter at 0.618 if price shows rejection (doji, pin bar)",
      "0.786 is more aggressive but higher probability"
    ],
    exit_rules: [
      "Exit at 0 (swing origin) or next swing structure",
      "Trail stop at 0.5 level once price clears above 0.618",
      "Hard stop at 0.886 level (break of entry structure)"
    ],
    risk_reward_min: 2.5,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 3.8,
  },
  {
    name: "VWAP Trading",
    description: "Volume-Weighted Average Price bounces and trend-following with multi-timeframe confluence",
    type: "day",
    timeframes: ["5m", "15m", "1h"],
    indicators: ["VWAP", "Volume", "RSI", "MACD"],
    entry_rules: [
      "VWAP bounce: price touches VWAP from above/below, quick reversal",
      "Trend trade: price above VWAP (bull) on volume increase",
      "Enter on breakeven retest of VWAP after touch",
      "Confirm with volume profile support at VWAP"
    ],
    exit_rules: [
      "Exit on VWAP break in opposite direction",
      "Trail profit: move stop to VWAP as price advances",
      "Tighten stop on lower timeframe pullbacks"
    ],
    risk_reward_min: 1.5,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 4.0,
  },
  {
    name: "Moving Average Crossover",
    description: "EMA 9/21/50/200 crossovers with confluence for trend confirmation and reversals",
    type: "swing",
    timeframes: ["1h", "4h"],
    indicators: ["EMA 9", "EMA 21", "EMA 50", "EMA 200"],
    entry_rules: [
      "Bullish: EMA 9 crosses above EMA 21 (fast above slow)",
      "Confluence: Price above EMA 50 and EMA 200 for trend",
      "Enter on crossover candle close or retest of 9-EMA",
      "Stronger setup: all four EMAs in proper order (9>21>50>200)"
    ],
    exit_rules: [
      "Exit on reverse crossover (9 crosses below 21)",
      "Trail stop below 21-EMA once 50-EMA is cleared",
      "Hard stop at break of 9-EMA for tight exits"
    ],
    risk_reward_min: 1.5,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 3.7,
  },
  {
    name: "RSI Divergence",
    description: "Bullish and bearish divergences at RSI extremes (>70 or <30) for reversal entries",
    type: "swing",
    timeframes: ["1h", "4h"],
    indicators: ["RSI (14)", "Price Structure", "Volume"],
    entry_rules: [
      "Bearish divergence: price makes higher high but RSI makes lower high (at >70)",
      "Bullish divergence: price makes lower low but RSI makes higher low (at <30)",
      "Enter on candlestick rejection after divergence confirmation",
      "Volume confirmation on divergence bar"
    ],
    exit_rules: [
      "Exit at opposite extreme or structure support/resistance",
      "Trail stop below entry bar low (divergence bar)",
      "Hard stop at break of divergence structure"
    ],
    risk_reward_min: 2.0,
    best_regimes: ["ranging", "volatile"],
    accuracy_rating: 3.9,
  },
  {
    name: "Bollinger Band Squeeze",
    description: "Volatility compression breakouts using Bollinger Band squeeze detection",
    type: "day",
    timeframes: ["5m", "15m"],
    indicators: ["Bollinger Bands (20,2)", "Keltner Channel", "ATR", "Volume"],
    entry_rules: [
      "Squeeze: Bollinger Bands inside Keltner Channel (volatility contraction)",
      "Monitor for squeeze release: price break with volume spike",
      "Enter breakout in direction of squeeze breakout (usually strong)",
      "Confirm with volume increase and ATR expansion"
    ],
    exit_rules: [
      "Exit at upper/lower Bollinger Band on opposite side",
      "Trail profit: move stop to near-term swing point",
      "Take partial at 1.5R and trail full position"
    ],
    risk_reward_min: 2.0,
    best_regimes: ["volatile", "ranging"],
    accuracy_rating: 4.1,
  },
  {
    name: "Orderflow Absorption",
    description: "Large block detection, delta divergence, and aggressive orders at key levels",
    type: "scalp",
    timeframes: ["5m", "15m"],
    indicators: ["Delta Cumulative", "Large Orders", "Time & Sales", "Bid/Ask Imbalance"],
    entry_rules: [
      "Detect large buy blocks at support or sell blocks at resistance",
      "Delta divergence: price down but delta stays positive (buyers in control)",
      "Enter on absorption recovery: price reverses after large block absorption",
      "Confirm with bid/ask imbalance flipping"
    ],
    exit_rules: [
      "Exit when absorption exhausts (next large opposite order)",
      "Trail profit at each new momentum extreme",
      "Hard stop at break of absorption bar low"
    ],
    risk_reward_min: 1.2,
    best_regimes: ["ranging", "volatile"],
    accuracy_rating: 4.2,
  },
  {
    name: "Sweep & Reclaim",
    description: "Liquidity grab and liquidation hunting followed by reversal into protected traders",
    type: "swing",
    timeframes: ["15m", "1h"],
    indicators: ["Liquidity Levels", "Stop Hunts", "Volume Spikes", "Price Action"],
    entry_rules: [
      "Identify protected liquidity below support (stops, limit orders)",
      "Sweep: price breaks level, stops hit, volume spike",
      "Reclaim: price reverses and reclaims the broken level",
      "Enter on reclaim candle close or pullback to swept level"
    ],
    exit_rules: [
      "Exit at next liquidity level (previous resistance)",
      "Trail stop below sweep point (invalidation)",
      "Tighten on pullbacks within reclaim move"
    ],
    risk_reward_min: 1.8,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 4.3,
  },
  {
    name: "Gap Fill Strategy",
    description: "Opening gap analysis and mean-reversion fills on forex and futures markets",
    type: "day",
    timeframes: ["1h", "4h"],
    indicators: ["Opening Gap", "Volume", "Resistance/Support", "ATR"],
    entry_rules: [
      "Identify opening gap (difference between previous close and current open)",
      "Up-gap: usually filled (price pulls back) during day",
      "Enter on reversal from gap top (mean reversion) or gap bottom (trend follow)",
      "Larger gaps (2+ ATR) more likely to fill than small gaps"
    ],
    exit_rules: [
      "Exit at gap fill point (previous close level)",
      "Trail stop above gap top if trading gap continuation",
      "Cut loss at break of entry bar (tight stops)"
    ],
    risk_reward_min: 1.5,
    best_regimes: ["ranging", "volatile"],
    accuracy_rating: 3.9,
  },
  {
    name: "Momentum Ignition",
    description: "Volume burst detection at key levels signaling acceleration and breakout direction",
    type: "day",
    timeframes: ["5m", "15m"],
    indicators: ["Volume", "Volume MA", "Price Velocity", "Momentum Oscillators"],
    entry_rules: [
      "Detect volume spike 2x above 20-candle average at support/resistance",
      "Momentum ignition: sharp price move with bursting volume",
      "Enter in direction of volume surge (imbalance)",
      "Confirm with price acceleration (higher highs or lower lows)"
    ],
    exit_rules: [
      "Exit on volume exhaustion (volume spike reversal)",
      "Trail profit at each new extreme",
      "Hard stop at momentum invalidation bar"
    ],
    risk_reward_min: 1.3,
    best_regimes: ["volatile", "trending_bull", "trending_bear"],
    accuracy_rating: 4.0,
  },
  {
    name: "Mean Reversion - Overextension",
    description: "Overextended price snapback to moving average or structural mean using extremes",
    type: "day",
    timeframes: ["15m", "1h"],
    indicators: ["EMA 20", "RSI Extremes", "Bollinger Bands", "ATR"],
    entry_rules: [
      "Detect overextension: RSI >90 or <10 with price far from EMA 20",
      "Price above upper Bollinger Band by 1+ ATR",
      "Enter on reversal candle or momentum divergence",
      "Confirm exhaustion with volume decline"
    ],
    exit_rules: [
      "Exit at EMA 20 or midband (Bollinger mean)",
      "Trail stop at recent swing high/low",
      "Take partial at 0.5R and trail for larger moves"
    ],
    risk_reward_min: 1.5,
    best_regimes: ["ranging", "volatile"],
    accuracy_rating: 4.0,
  },
  {
    name: "Multi-Timeframe Confluence",
    description: "Combining signals from 1h/4h/1d for high-probability structural setups",
    type: "position",
    timeframes: ["1h", "4h", "1d"],
    indicators: ["Structure Alignment", "Support/Resistance", "Trend Direction", "Volume"],
    entry_rules: [
      "Identify trend: all three timeframes showing same direction",
      "Entry: lower timeframe pullback to 4h/1d support/resistance",
      "Require 2+ of: break & retest, supply/demand zone, moving average confluence",
      "Volume confirmation on entry candle"
    ],
    exit_rules: [
      "Exit at next 4h/1d structure (higher timeframe target)",
      "Trail stop at HTF support/resistance",
      "Hard stop at LTF structure break"
    ],
    risk_reward_min: 2.5,
    best_regimes: ["trending_bull", "trending_bear"],
    accuracy_rating: 4.4,
  },
];

export function getStrategyForSetup(setupType: string, regime: string): TradingStrategy[] {
  // Filter strategies by best regimes and setup type compatibility
  const regimeWeights = getRegimeWeights(regime);

  // Map setup types to compatible strategies
  const setupMap: Record<string, string[]> = {
    "breakout": ["Break & Retest Strategy", "Bollinger Band Squeeze", "Momentum Ignition"],
    "retracement": ["Fibonacci Retracement Trades", "Supply & Demand Zones", "Mean Reversion - Overextension"],
    "reversal": ["RSI Divergence", "Sweep & Reclaim", "SMC - Order Blocks"],
    "trend": ["Moving Average Crossover", "VWAP Trading", "Multi-Timeframe Confluence"],
    "scalp": ["ICT - Optimal Trade Entry", "Orderflow Absorption", "Momentum Ignition"],
    "swing": ["Wyckoff Method - Accumulation Phase", "Supply & Demand Zones", "Break & Retest Strategy"],
    "position": ["Multi-Timeframe Confluence", "Wyckoff Method - Accumulation Phase"],
    "gap": ["Gap Fill Strategy"],
    "smarts_money": ["SMC - Order Blocks", "Sweep & Reclaim", "ICT - Optimal Trade Entry"],
  };

  const compatibleNames = setupMap[setupType] || [];

  return TRADING_STRATEGIES.filter((strategy) => {
    // Include if in compatible setup types
    if (compatibleNames.includes(strategy.name)) return true;

    // Include if strategy is optimal for this regime
    if (strategy.best_regimes.includes(regime)) return true;

    return false;
  }).sort((a, b) => b.accuracy_rating - a.accuracy_rating);
}

// ── 2. Ensemble ML: Gradient Boosted Decision Stumps + Logistic Regression ──
// The existing logistic regression is Layer 1. We add a gradient-boosted
// ensemble of shallow decision stumps (depth=1) as Layer 2, then vote.
// This catches non-linear interactions the LR misses.

class GradientBoostedStumps {
  stumps: Array<{ featureIdx: number; threshold: number; leftVal: number; rightVal: number; weight: number }> = [];
  trained = false;
  accuracy = 0;

  train(X: number[][], y: number[], nStumps = 100, learningRate = 0.1): void {
    const n = X.length;
    if (n < 50) return;
    const dim = X[0].length;

    // Initialize predictions to base rate (log-odds)
    const baseRate = y.reduce((s, v) => s + v, 0) / n;
    const baseLogOdds = Math.log(baseRate / (1 - baseRate + 1e-10));
    const F = new Float64Array(n).fill(baseLogOdds);

    for (let round = 0; round < nStumps; round++) {
      // Compute pseudo-residuals (gradient of log-loss)
      const residuals = new Float64Array(n);
      for (let i = 0; i < n; i++) {
        const p = 1 / (1 + Math.exp(-F[i]));
        residuals[i] = y[i] - p;
      }

      // Find best stump (single split)
      let bestGain = -Infinity;
      let bestFeature = 0, bestThresh = 0, bestLeft = 0, bestRight = 0;

      for (let f = 0; f < dim; f++) {
        // Try 10 quantile thresholds per feature
        const vals = X.map(row => row[f]).sort((a, b) => a - b);
        for (let q = 1; q <= 9; q++) {
          const thresh = vals[Math.floor(n * q / 10)];
          let leftSum = 0, leftCount = 0, rightSum = 0, rightCount = 0;
          for (let i = 0; i < n; i++) {
            if (X[i][f] <= thresh) { leftSum += residuals[i]; leftCount++; }
            else { rightSum += residuals[i]; rightCount++; }
          }
          if (leftCount === 0 || rightCount === 0) continue;
          const leftMean = leftSum / leftCount;
          const rightMean = rightSum / rightCount;
          const gain = leftSum * leftMean + rightSum * rightMean;
          if (gain > bestGain) {
            bestGain = gain;
            bestFeature = f;
            bestThresh = thresh;
            bestLeft = leftMean;
            bestRight = rightMean;
          }
        }
      }

      this.stumps.push({
        featureIdx: bestFeature,
        threshold: bestThresh,
        leftVal: bestLeft * learningRate,
        rightVal: bestRight * learningRate,
        weight: learningRate,
      });

      // Update predictions
      for (let i = 0; i < n; i++) {
        if (X[i][bestFeature] <= bestThresh) F[i] += bestLeft * learningRate;
        else F[i] += bestRight * learningRate;
      }
    }

    this.trained = true;

    // Compute accuracy
    let correct = 0;
    for (let i = 0; i < n; i++) {
      const p = this.predict(X[i]);
      if ((p >= 0.5 && y[i] === 1) || (p < 0.5 && y[i] === 0)) correct++;
    }
    this.accuracy = correct / n;
  }

  predict(features: number[]): number {
    if (!this.trained || this.stumps.length === 0) return 0.5;
    let F = 0;
    for (const stump of this.stumps) {
      F += (features[stump.featureIdx] ?? 0) <= stump.threshold
        ? stump.leftVal : stump.rightVal;
    }
    return 1 / (1 + Math.exp(-F));
  }
}

// ── 3. Kelly Criterion Position Sizing ──────────────────────────────────────
// Full Kelly is too aggressive — we use fractional Kelly (25%) for safety.
// Kelly fraction = (p × b - q) / b
//   p = win probability, q = 1-p, b = avg_win / avg_loss (reward:risk ratio)

const KELLY_FRACTION = 0.25; // Quarter-Kelly for safety
const MIN_POSITION_PCT = 0.005; // 0.5% minimum
const MAX_POSITION_PCT = 0.03;  // 3% maximum per trade

function kellySize(
  winProb: number,
  rewardRiskRatio: number,
  equity: number,
  entryPrice: number,
): { fraction: number; qty: number } {
  const p = Math.max(0.01, Math.min(0.99, winProb));
  const q = 1 - p;
  const b = Math.max(0.1, rewardRiskRatio);

  // Full Kelly
  let fullKelly = (p * b - q) / b;

  // Clamp: if negative edge, don't trade
  if (fullKelly <= 0) return { fraction: 0, qty: 0 };

  // Apply fractional Kelly
  let fraction = fullKelly * KELLY_FRACTION;
  fraction = Math.max(MIN_POSITION_PCT, Math.min(MAX_POSITION_PCT, fraction));

  // Convert to quantity
  const dollarSize = equity * fraction;
  const qty = Math.max(0, Math.floor(dollarSize / entryPrice * 1000) / 1000);

  return { fraction, qty };
}

// ── 4. Multi-Timeframe Confluence ───────────────────────────────────────────
// Require 2+ out of 3 timeframes to agree for signal approval.
// Each timeframe contributes a directional bias score (0-1).

const TIMEFRAMES = ["1m", "5m", "15m"] as const;
const CONFLUENCE_THRESHOLD = 0.55; // Score above this = aligned
const MIN_ALIGNED_TF = 2; // Need at least 2 timeframes agreeing

function computeConfluence(
  tfScores: Record<string, number> | undefined,
  direction: "long" | "short",
): { score: number; aligned: number } {
  if (!tfScores || Object.keys(tfScores).length === 0) {
    return { score: 0.5, aligned: 0 }; // Neutral if no MTF data
  }

  let aligned = 0;
  let totalScore = 0;
  let count = 0;

  for (const tf of TIMEFRAMES) {
    const raw = tfScores[tf];
    if (raw == null) continue;
    // For long: high score = aligned. For short: low score = aligned
    const dirScore = direction === "long" ? raw : 1 - raw;
    if (dirScore >= CONFLUENCE_THRESHOLD) aligned++;
    totalScore += dirScore;
    count++;
  }

  const avgScore = count > 0 ? totalScore / count : 0.5;
  return { score: avgScore, aligned };
}

// ── 5. Trailing Stop & Partial Profit Engine ────────────────────────────────

function buildTrailingStop(
  regime: string,
  atr: number,
  winProb: number,
): TrailingStopConfig {
  // Trending: wider stops (let winners run). Ranging: tighter stops.
  const isStrong = regime.includes("trending");
  const isTrending = isStrong;

  return {
    initial_atr_multiple: isTrending ? 2.5 : 1.8,
    activation_atr: isTrending ? 1.5 : 1.0,
    trail_step: isTrending ? 0.4 : 0.6, // Trending: trail less aggressively
    max_hold_minutes: isTrending ? 180 : 90,
  };
}

function buildProfitTargets(
  regime: string,
  winProb: number,
  rewardRiskRatio: number,
): ProfitTarget[] {
  const isHighConf = winProb >= 0.65;
  const isTrending = regime.includes("trending");

  if (isTrending && isHighConf) {
    // High confidence trending: scale out slowly, let runner ride
    return [
      { close_pct: 0.33, r_target: 1.5 },
      { close_pct: 0.33, r_target: 3.0 },
      { close_pct: 0.34, r_target: 5.0 },
    ];
  }

  if (isTrending) {
    // Trending normal: scale out in thirds
    return [
      { close_pct: 0.33, r_target: 1.0 },
      { close_pct: 0.33, r_target: 2.0 },
      { close_pct: 0.34, r_target: 3.5 },
    ];
  }

  // Ranging / volatile: take profit faster
  return [
    { close_pct: 0.50, r_target: 1.0 },
    { close_pct: 0.30, r_target: 1.5 },
    { close_pct: 0.20, r_target: 2.5 },
  ];
}

// ── 6. Global Ensemble Model Instance ───────────────────────────────────────

let _gbm: GradientBoostedStumps | null = null;
let _ensembleStatus: "untrained" | "trained" | "error" = "untrained";
let _ensembleMeta: {
  gbm_accuracy: number;
  lr_accuracy: number;
  ensemble_accuracy: number;
  samples: number;
  trained_at: string;
} | null = null;

// ── Feature engineering (same as ml_model.ts for consistency) ──

const SETUP_TYPES = ["absorption_reversal", "sweep_reclaim", "continuation_pullback", "cvd_divergence", "breakout_failure"] as const;
const REGIMES = ["trending_bull", "trending_bear", "ranging", "volatile", "chop"] as const;

function featurize(row: {
  structure_score: number; order_flow_score: number; recall_score: number;
  final_quality: number; setup_type: string; regime: string; direction?: string;
}): number[] {
  const base = [
    row.structure_score,
    row.order_flow_score,
    row.recall_score,
    row.final_quality,
    row.structure_score * row.order_flow_score,
    row.recall_score * row.structure_score,
    Math.abs(row.structure_score - row.order_flow_score),
    row.direction === "long" ? 1 : 0,
  ];
  const setupOH = SETUP_TYPES.map(s => s === row.setup_type ? 1 : 0);
  const regimeOH = REGIMES.map(r => r === row.regime ? 1 : 0);
  return [...base, ...setupOH, ...regimeOH];
}

/**
 * Train the ensemble model. Call after ml_model.trainModel().
 * Uses the same data source (accuracy_results).
 */
export async function trainEnsemble(): Promise<void> {
  try {
    logger.info("[super] Training gradient-boosted ensemble...");

    // Dynamic import to avoid circular deps
    const { db, accuracyResultsTable } = await import("@workspace/db");
    const { and, or, eq, isNotNull } = await import("drizzle-orm");

    const rows = await db
      .select({
        structure_score: accuracyResultsTable.structure_score,
        order_flow_score: accuracyResultsTable.order_flow_score,
        recall_score: accuracyResultsTable.recall_score,
        final_quality: accuracyResultsTable.final_quality,
        setup_type: accuracyResultsTable.setup_type,
        regime: accuracyResultsTable.regime,
        direction: accuracyResultsTable.direction,
        outcome: accuracyResultsTable.outcome,
      })
      .from(accuracyResultsTable)
      .where(
        and(
          or(eq(accuracyResultsTable.outcome, "win"), eq(accuracyResultsTable.outcome, "loss")),
          isNotNull(accuracyResultsTable.structure_score),
          isNotNull(accuracyResultsTable.order_flow_score)
        )
      )
      .limit(200_000);

    if (rows.length < 50) {
      logger.info(`[super] Only ${rows.length} samples — need ≥50 for ensemble.`);
      _ensembleStatus = "untrained";
      return;
    }

    const X: number[][] = [];
    const y: number[] = [];
    for (const row of rows) {
      X.push(featurize({
        structure_score: parseFloat(String(row.structure_score ?? "0")),
        order_flow_score: parseFloat(String(row.order_flow_score ?? "0")),
        recall_score: parseFloat(String(row.recall_score ?? "0")),
        final_quality: parseFloat(String(row.final_quality ?? "0")),
        setup_type: row.setup_type ?? "absorption_reversal",
        regime: row.regime ?? "ranging",
        direction: row.direction ?? "long",
      }));
      y.push(row.outcome === "win" ? 1 : 0);
    }

    // Train GBM
    const gbm = new GradientBoostedStumps();
    gbm.train(X, y, 150, 0.08);

    // Get LR accuracy from existing model
    const mlStatus = getModelStatus();
    const lrAccuracy = mlStatus.meta?.accuracy ?? 0;

    // Compute ensemble accuracy (average of both predictions, majority vote)
    let ensembleCorrect = 0;
    for (let i = 0; i < X.length; i++) {
      const gbmPred = gbm.predict(X[i]);
      const lrPred = predictWinProbability({
        structure_score: parseFloat(String(rows[i].structure_score ?? "0")),
        order_flow_score: parseFloat(String(rows[i].order_flow_score ?? "0")),
        recall_score: parseFloat(String(rows[i].recall_score ?? "0")),
        final_quality: parseFloat(String(rows[i].final_quality ?? "0")),
        setup_type: rows[i].setup_type ?? "absorption_reversal",
        regime: rows[i].regime ?? "ranging",
        direction: rows[i].direction ?? "long",
      }).probability;

      // Ensemble: 60% GBM + 40% LR (GBM captures non-linear patterns better)
      const ensemblePred = 0.60 * gbmPred + 0.40 * lrPred;
      if ((ensemblePred >= 0.5 && y[i] === 1) || (ensemblePred < 0.5 && y[i] === 0)) {
        ensembleCorrect++;
      }
    }

    _gbm = gbm;
    _ensembleStatus = "trained";
    _ensembleMeta = {
      gbm_accuracy: gbm.accuracy,
      lr_accuracy: lrAccuracy,
      ensemble_accuracy: ensembleCorrect / X.length,
      samples: X.length,
      trained_at: new Date().toISOString(),
    };

    logger.info(`[super] Ensemble trained successfully:`);
    logger.info(`[super]   GBM accuracy: ${(gbm.accuracy * 100).toFixed(1)}%`);
    logger.info(`[super]   LR accuracy:  ${(lrAccuracy * 100).toFixed(1)}%`);
    logger.info(`[super]   Ensemble:     ${(_ensembleMeta.ensemble_accuracy * 100).toFixed(1)}%`);
    logger.info(`[super]   Samples:      ${X.length}`);
  } catch (err) {
    console.error("[super] Ensemble training failed:", err);
    _ensembleStatus = "error";
  }
}

function safeNum(v: number, fallback = 0.5): number {
  return (typeof v === "number" && !Number.isNaN(v) && Number.isFinite(v))
    ? Math.max(0, Math.min(1, v))
    : fallback;
}

function ensemblePredict(input: {
  structure_score: number; order_flow_score: number; recall_score: number;
  final_quality: number; setup_type: string; regime: string; direction?: string;
}): number {
  const lrResult = predictWinProbability(input);

  if (_gbm?.trained) {
    const features = featurize(input);
    const gbmPred = _gbm.predict(features);
    // Weighted ensemble: 60% GBM + 40% LR
    const result = 0.60 * gbmPred + 0.40 * lrResult.probability;
    return safeNum(result, lrResult.probability);
  }

  // Fallback to LR only
  return safeNum(lrResult.probability);
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN ENTRY POINT: Process a signal through Super Intelligence
// ══════════════════════════════════════════════════════════════════════════════

export async function processSuperSignal(
  signalId: number,
  symbol: string,
  input: SuperIntelligenceInput
): Promise<SuperSignal> {
  const {
    structure_score, order_flow_score, recall_score,
    setup_type, regime, direction,
    entry_price, stop_loss, take_profit,
    atr, equity, timeframe_scores,
  } = input;

  // 1. Get regime-adaptive weights
  const weights = getRegimeWeights(regime);

  // 2. Compute enhanced quality with adaptive weights
  const ml_raw = ensemblePredict({
    structure_score, order_flow_score, recall_score,
    final_quality: 0, // Will be computed
    setup_type, regime, direction,
  });

  // Claude / Heuristic Reasoning layer: strict fallback policy
  const reasoning = await reasonTradeDecision(signalId, symbol, {
    structure: structure_score,
    order_flow: order_flow_score,
    recall: recall_score,
    setup_type,
    regime,
    direction,
  });

  const claude_est = safeNum(reasoning.winProbability);

  const enhanced_quality = safeNum(
    weights.structure * safeNum(structure_score, 0) +
    weights.order_flow * safeNum(order_flow_score, 0) +
    weights.recall * safeNum(recall_score, 0) +
    weights.ml * safeNum(ml_raw) +
    weights.claude * claude_est
  );

  // Base quality (original formula for comparison)
  const base_quality = safeNum(
    0.32 * safeNum(structure_score, 0) + 0.28 * safeNum(order_flow_score, 0) +
    0.20 * safeNum(recall_score, 0) + 0.08 * (0.55 + safeNum(recall_score, 0) * 0.25) +
    0.12 * claude_est
  );

  // 3. Ensemble win probability
  const win_probability = safeNum(ensemblePredict({
    structure_score, order_flow_score, recall_score,
    final_quality: enhanced_quality,
    setup_type, regime, direction,
  }));

  // 4. Multi-timeframe confluence
  const { score: confluence_score, aligned: aligned_timeframes } =
    computeConfluence(timeframe_scores, direction);

  // 5. Reward:risk ratio
  const risk = Math.abs(entry_price - stop_loss) || 1;
  const reward = Math.abs(take_profit - entry_price) || 1;
  const rewardRiskRatio = safeNum(reward / risk, 1);

  // 6. Kelly position sizing
  const { fraction: kelly_fraction, qty: suggested_qty } =
    kellySize(win_probability, rewardRiskRatio, equity, entry_price);

  // 7. Trailing stop config
  const trailing_stop = buildTrailingStop(regime, atr, win_probability);

  // 8. Profit targets
  const profit_targets = buildProfitTargets(regime, win_probability, rewardRiskRatio);

  // 9. Edge score: expected value per dollar risked
  // EV = (winProb × avgWin) - (lossProb × avgLoss)
  const edge_score = win_probability * rewardRiskRatio - (1 - win_probability);

  // 10. Super Intelligence Gate — must pass ALL:
  //   a. Enhanced quality ≥ regime threshold
  //   b. Win probability ≥ 55%
  //   c. Multi-TF confluence ≥ 2 aligned (if MTF data available)
  //   d. Edge score > 0 (positive expected value)
  //   e. Kelly says to bet (fraction > 0)
  //   f. Not in chop regime (unless quality > 0.85)

  const regimeThresholds: Record<string, number> = {
    trending_bull: 0.58, trending_bear: 0.60,
    ranging: 0.68, volatile: 0.75, chop: 0.85,
  };
  const qualityThreshold = regimeThresholds[regime] ?? 0.68;
  const hasMTF = timeframe_scores && Object.keys(timeframe_scores).length > 0;

  let approved = true;
  let rejection_reason: string | undefined;

  if (enhanced_quality < qualityThreshold) {
    approved = false;
    rejection_reason = `Quality ${(enhanced_quality * 100).toFixed(1)}% below ${regime} threshold ${(qualityThreshold * 100).toFixed(0)}%`;
  } else if (win_probability < 0.55) {
    approved = false;
    rejection_reason = `Win probability ${(win_probability * 100).toFixed(1)}% below 55% minimum`;
  } else if (hasMTF && aligned_timeframes < MIN_ALIGNED_TF) {
    approved = false;
    rejection_reason = `Only ${aligned_timeframes}/${TIMEFRAMES.length} timeframes aligned (need ${MIN_ALIGNED_TF})`;
  } else if (edge_score <= 0) {
    approved = false;
    rejection_reason = `Negative edge: EV = ${edge_score.toFixed(3)} (need > 0)`;
  } else if (kelly_fraction <= 0) {
    approved = false;
    rejection_reason = "Kelly criterion says no bet (negative expected value)";
  }

  return {
    base_quality: Math.max(0, Math.min(1, base_quality)),
    enhanced_quality,
    win_probability,
    kelly_fraction,
    suggested_qty,
    regime_weights: weights,
    confluence_score,
    aligned_timeframes,
    trailing_stop,
    profit_targets,
    approved,
    rejection_reason,
    edge_score,
  };
}

// ── Status & Diagnostics ────────────────────────────────────────────────────

export function getSuperIntelligenceStatus(): {
  status: "active" | "partial" | "inactive";
  ensemble: typeof _ensembleMeta;
  message: string;
} {
  if (_ensembleStatus === "trained" && _ensembleMeta) {
    return {
      status: "active",
      ensemble: _ensembleMeta,
      message: `Ensemble active: ${(_ensembleMeta.ensemble_accuracy * 100).toFixed(1)}% accuracy (GBM ${(_ensembleMeta.gbm_accuracy * 100).toFixed(1)}% + LR ${(_ensembleMeta.lr_accuracy * 100).toFixed(1)}%) on ${_ensembleMeta.samples} samples`,
    };
  }

  const mlStatus = getModelStatus();
  if (mlStatus.status === "active") {
    return {
      status: "partial",
      ensemble: null,
      message: "LR model active, GBM training pending — running single-model mode",
    };
  }

  return {
    status: "inactive",
    ensemble: null,
    message: "Super Intelligence inactive — using heuristic pipeline scoring",
  };
}

// ══════════════════════════════════════════════════════════════════════════════
// AUTONOMOUS MODE: Auto-scans symbols, evaluates strategies, logs decisions
// ══════════════════════════════════════════════════════════════════════════════

export interface StrategyRating {
  name: string;
  setup_type: string;
  regime: string;
  win_rate: number;
  profit_factor: number;
  sharpe_ratio: number;
  edge_score: number;
  total_trades: number;
  stars: number; // 1-5 star rating
  last_updated: string;
}

let _autonomousMode = false;
let _autonomousLoopInterval: NodeJS.Timer | null = null;
let _strategyRatings: Map<string, StrategyRating> = new Map();

/**
 * Start autonomous mode: runs every 60 seconds, scans all watched symbols,
 * evaluates strategies, and logs decisions to database
 */
export async function startAutonomousMode(): Promise<{ success: boolean; message: string }> {
  if (_autonomousMode) {
    return { success: false, message: "Autonomous mode already running" };
  }

  _autonomousMode = true;
  logger.info("[super] Autonomous mode started — will scan every 60 seconds");

  // Initial scan immediately
  await autonomousScan();

  // Set up recurring scan every 60 seconds
  _autonomousLoopInterval = setInterval(async () => {
    try {
      await autonomousScan();
    } catch (err) {
      console.error("[super] Autonomous scan error:", err);
    }
  }, 60_000);

  return { success: true, message: "Autonomous mode activated — scanning every 60s" };
}

/**
 * Stop autonomous mode
 */
export function stopAutonomousMode(): { success: boolean; message: string } {
  if (!_autonomousMode) {
    return { success: false, message: "Autonomous mode not running" };
  }

  if (_autonomousLoopInterval) {
    clearInterval(_autonomousLoopInterval);
    _autonomousLoopInterval = null;
  }

  _autonomousMode = false;
  logger.info("[super] Autonomous mode stopped");
  return { success: true, message: "Autonomous mode deactivated" };
}

/**
 * Internal: perform one autonomous scan cycle
 */
async function autonomousScan(): Promise<void> {
  try {
    logger.info("[super] [autonomy] Starting scan cycle...");
    const { db, accuracyResultsTable } = await import("@workspace/db");
    const { eq, isNotNull } = await import("drizzle-orm");

    // Fetch recent signals (last 24 hours) grouped by symbol/setup/regime
    const now = new Date();
    const last24h = new Date(now.getTime() - 24 * 60 * 60 * 1000);

    const recentSignals = await db
      .select({
        id: accuracyResultsTable.id,
        symbol: accuracyResultsTable.symbol,
        setup_type: accuracyResultsTable.setup_type,
        regime: accuracyResultsTable.regime,
        direction: accuracyResultsTable.direction,
        structure_score: accuracyResultsTable.structure_score,
        order_flow_score: accuracyResultsTable.order_flow_score,
        recall_score: accuracyResultsTable.recall_score,
        final_quality: accuracyResultsTable.final_quality,
        outcome: accuracyResultsTable.outcome,
        entry_price: accuracyResultsTable.entry_price,
        stop_loss: accuracyResultsTable.stop_loss,
        take_profit: accuracyResultsTable.take_profit,
        atr: accuracyResultsTable.atr,
        created_at: accuracyResultsTable.created_at,
      })
      .from(accuracyResultsTable)
      .where(isNotNull(accuracyResultsTable.structure_score))
      .limit(200);

    logger.info(`[super] [autonomy] Scanned ${recentSignals.length} recent signals`);

    // Process each signal through SI pipeline
    let siApprovedCount = 0;
    for (const signal of recentSignals) {
      const r = signal as any;
      const structure = parseFloat(String(r.structure_score ?? "0"));
      const orderFlow = parseFloat(String(r.order_flow_score ?? "0"));
      const recall = parseFloat(String(r.recall_score ?? "0"));

      const result = await processSuperSignal(r.id ?? 0, r.symbol ?? "UNKNOWN", {
        structure_score: structure,
        order_flow_score: orderFlow,
        recall_score: recall,
        setup_type: r.setup_type ?? "absorption_reversal",
        regime: r.regime ?? "ranging",
        direction: (r.direction ?? "long") as "long" | "short",
        entry_price: r.entry_price ?? 100,
        stop_loss: r.stop_loss ?? 99,
        take_profit: r.take_profit ?? 105,
        atr: r.atr ?? 1.0,
        equity: 10_000,
      });

      if (result.approved) {
        siApprovedCount++;
        logger.info(`[super] [autonomy] Signal ${r.id} approved: ${r.setup_type}/${r.regime}, WP=${(result.win_probability * 100).toFixed(0)}%`);
      }
    }

    // Update strategy ratings
    await updateStrategyRatings(recentSignals);

    logger.info(`[super] [autonomy] Cycle complete: ${siApprovedCount}/${recentSignals.length} approved`);
  } catch (err) {
    console.error("[super] [autonomy] Scan cycle failed:", err);
  }
}

/**
 * Update strategy ratings based on historical performance
 */
async function updateStrategyRatings(signals: any[]): Promise<void> {
  try {
    const { db, accuracyResultsTable } = await import("@workspace/db");
    const { and, eq, isNotNull } = await import("drizzle-orm");

    // Group by setup_type + regime combo
    const combos = new Map<string, typeof signals>();
    for (const sig of signals) {
      const key = `${sig.setup_type ?? "absorption_reversal"}::${sig.regime ?? "ranging"}`;
      if (!combos.has(key)) combos.set(key, []);
      combos.get(key)!.push(sig);
    }

    // For each combo, calculate metrics
    for (const [key, combo] of combos) {
      const [setupType, regime] = key.split("::");

      // Query historical performance
      const history = await db
        .select({
          outcome: accuracyResultsTable.outcome,
          edge_score: accuracyResultsTable.edge_score,
        })
        .from(accuracyResultsTable)
        .where(
          and(
            eq(accuracyResultsTable.setup_type, setupType),
            eq(accuracyResultsTable.regime, regime),
            isNotNull(accuracyResultsTable.outcome)
          )
        )
        .limit(1000);

      if (history.length === 0) continue;

      const wins = history.filter(h => h.outcome === "win").length;
      const total = history.length;
      const winRate = total > 0 ? wins / total : 0;

      // Simplified profit factor (assume avg win 2%, avg loss 1.5%)
      const profitFactor = winRate > 0 ? (winRate * 2) / ((1 - winRate) * 1.5) : 1;

      // Simplified Sharpe (use win_rate as proxy)
      const sharpe = winRate > 0.5 ? (winRate - 0.5) * 2 : 0;

      // Calculate star rating (1-5)
      let stars = 1;
      if (winRate > 0.55) stars = 2;
      if (winRate > 0.60) stars = 3;
      if (winRate > 0.65) stars = 4;
      if (winRate > 0.70) stars = 5;

      const rating: StrategyRating = {
        name: `${setupType} in ${regime}`,
        setup_type: setupType,
        regime,
        win_rate: winRate,
        profit_factor: profitFactor,
        sharpe_ratio: sharpe,
        edge_score: winRate * profitFactor - (1 - winRate),
        total_trades: total,
        stars,
        last_updated: new Date().toISOString(),
      };

      _strategyRatings.set(key, rating);
      logger.info(`[super] Updated rating for ${key}: ${stars}★ WR=${(winRate * 100).toFixed(0)}%`);
    }
  } catch (err) {
    console.error("[super] [autonomy] Strategy rating update failed:", err);
  }
}

/**
 * Get current autonomous mode status
 */
export function getAutonomousModeStatus(): {
  enabled: boolean;
  message: string;
  strategy_count: number;
} {
  return {
    enabled: _autonomousMode,
    message: _autonomousMode ? "Autonomous scanning active" : "Autonomous mode inactive",
    strategy_count: _strategyRatings.size,
  };
}

/**
 * Get strategy leaderboard (sorted by star rating and win rate)
 */
export function getStrategyLeaderboard(): StrategyRating[] {
  const strategies = Array.from(_strategyRatings.values());
  return strategies.sort((a, b) => {
    // Sort by stars descending, then by win_rate descending
    if (b.stars !== a.stars) return b.stars - a.stars;
    return b.win_rate - a.win_rate;
  });
}
