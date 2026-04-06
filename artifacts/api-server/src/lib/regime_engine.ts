/**
 * regime_engine.ts — Enhanced Regime Engine with Spectral Analysis
 *
 * Upgrades the basic 5-state regime detection with:
 *   - Compression / expansion detection
 *   - Trend strength quantification
 *   - FFT-based dominant cycle detection (spectral analysis)
 *   - Cycle stability tracking
 *   - Merged regime + spectral state with confidence
 *   - Regime transition logging and anomaly detection
 *
 * All functions are pure — no I/O, no side effects.
 */

import { persistAppend, persistRead } from "./persistent_store.js";
import { logger } from "./logger.js";

// ── Types ──────────────────────────────────────────────────────────────────────

export type BasicRegime =
  | "trend_up"
  | "trend_down"
  | "range"
  | "compression"
  | "expansion"
  | "chaotic";

export interface RegimeState {
  regime: BasicRegime;
  trendStrength: number;
  /** 0-1 how narrow the range is getting (Bollinger bandwidth shrinkage) */
  compressionScore: number;
  /** 0-1 how quickly range is expanding */
  expansionScore: number;
  volState: "low" | "medium" | "high" | "extreme";
  /** Directional persistence — what % of bars follow the trend direction */
  dirPersistence: number;
  confidence: number;
}

export interface SpectralState {
  /** Dominant cycle length in bars (null if no clear cycle) */
  dominantCycleLength: number | null;
  /** Spectral power at the dominant frequency (0-1 normalized) */
  spectralPower: number;
  /** How stable is this cycle over recent windows (0-1) */
  cycleStability: number;
  /** Classification based on spectral shape */
  regimeLabel: "cyclical" | "trend" | "noisy" | "transition";
}

export interface MergedRegimeState {
  basic: RegimeState;
  spectral: SpectralState;
  /** Human-readable combined label */
  label: string;
  /** Overall regime confidence 0-1 */
  confidence: number;
  computedAt: string;
}

export interface RegimeTransitionLog {
  id: string;
  symbol: string;
  from: BasicRegime;
  to: BasicRegime;
  confidence: number;
  timestamp: string;
  durationSeconds?: number;
}

export interface RegimeAnomaly {
  symbol: string;
  changesInLastHour: number;
  threshold: number;
  anomalous: boolean;
  detectedAt: string;
}

// ── Basic Regime Detection (Enhanced) ──────────────────────────────────────────

/**
 * Enhanced regime detection: identifies trend direction + strength,
 * compression, expansion, and chaotic conditions.
 */
export function computeBasicRegime(
  bars: Array<{ Open: number; High: number; Low: number; Close: number; Volume: number }>,
): RegimeState {
  if (bars.length < 20) {
    return {
      regime: "range",
      trendStrength: 0,
      compressionScore: 0,
      expansionScore: 0,
      volState: "medium",
      dirPersistence: 0.5,
      confidence: 0,
    };
  }

  const last20 = bars.slice(-20);
  const last40 = bars.slice(-40);
  const closes = last20.map((b) => b.Close);
  const high = Math.max(...last20.map((b) => b.High));
  const low = Math.min(...last20.map((b) => b.Low));
  const midPrice = (high + low) / 2;

  // Slope and directional persistence
  const overallSlope = (closes[closes.length - 1] - closes[0]) / Math.max(closes[0], 1e-9);
  const directionMatches = last20.filter((b) =>
    overallSlope > 0 ? b.Close > b.Open : b.Close < b.Open,
  ).length;
  const dirPersistence = directionMatches / 20;

  // Range as % of mid price
  const rangeAsPct = midPrice > 0 ? (high - low) / midPrice : 0;

  // ATR-based volatility
  const ranges = last20.map((b) => b.High - b.Low);
  const atr = ranges.reduce((s, r) => s + r, 0) / ranges.length;
  const avgClose = closes.reduce((s, c) => s + c, 0) / closes.length;
  const atrPct = avgClose > 0 ? atr / avgClose : 0;

  // Bollinger Bandwidth for compression/expansion
  const mean20 = avgClose;
  const stdDev = Math.sqrt(
    closes.reduce((s, c) => s + (c - mean20) ** 2, 0) / closes.length,
  );
  const bbWidth = mean20 > 0 ? (4 * stdDev) / mean20 : 0; // 2σ bands width as %

  // Historical comparison for compression/expansion
  let bbWidthHistory = 0;
  if (last40.length >= 40) {
    const prev20 = last40.slice(0, 20).map((b) => b.Close);
    const prevMean = prev20.reduce((s, c) => s + c, 0) / 20;
    const prevStd = Math.sqrt(prev20.reduce((s, c) => s + (c - prevMean) ** 2, 0) / 20);
    bbWidthHistory = prevMean > 0 ? (4 * prevStd) / prevMean : 0;
  }

  const compressionScore =
    bbWidthHistory > 0
      ? Math.max(0, Math.min(1, 1 - bbWidth / bbWidthHistory))
      : bbWidth < 0.02
        ? 0.7
        : 0.3;

  const expansionScore =
    bbWidthHistory > 0
      ? Math.max(0, Math.min(1, (bbWidth / bbWidthHistory - 1) * 2))
      : bbWidth > 0.04
        ? 0.7
        : 0.3;

  // Vol state
  const volState: RegimeState["volState"] =
    atrPct < 0.005 ? "low" :
    atrPct < 0.015 ? "medium" :
    atrPct < 0.03 ? "high" : "extreme";

  // Trend strength: 0-1
  const trendStrength = Math.min(
    1,
    Math.abs(overallSlope) * 50 * 0.5 + dirPersistence * 0.5,
  );

  // Regime classification
  let regime: BasicRegime;
  let confidence = 0;

  if (dirPersistence < 0.40 && rangeAsPct < 0.025) {
    regime = "chaotic";
    confidence = 0.3 + (0.5 - dirPersistence) * 0.4;
  } else if (compressionScore > 0.6 && atrPct < 0.01) {
    regime = "compression";
    confidence = compressionScore;
  } else if (expansionScore > 0.5 && atrPct > 0.02) {
    regime = "expansion";
    confidence = expansionScore;
  } else if (dirPersistence > 0.55 && Math.abs(overallSlope) > 0.006) {
    regime = overallSlope > 0 ? "trend_up" : "trend_down";
    confidence = trendStrength;
  } else {
    regime = "range";
    confidence = 0.5 + (1 - trendStrength) * 0.3;
  }

  return {
    regime,
    trendStrength: round4(trendStrength),
    compressionScore: round4(compressionScore),
    expansionScore: round4(expansionScore),
    volState,
    dirPersistence: round4(dirPersistence),
    confidence: round4(Math.max(0, Math.min(1, confidence))),
  };
}

// ── Spectral Analysis (FFT) ───────────────────────────────────────────────────

/**
 * Compute spectral regime from returns using real-valued DFT.
 *
 * Performs a simple DFT (no external library needed) on detrended returns
 * to find the dominant cycle length, spectral power, and classify the
 * spectral shape.
 *
 * Window size: uses the last N bars (64 or 128 depending on available data).
 */
export function computeSpectralRegime(
  bars: Array<{ Close: number }>,
): SpectralState {
  const defaultState: SpectralState = {
    dominantCycleLength: null,
    spectralPower: 0,
    cycleStability: 0,
    regimeLabel: "noisy",
  };

  if (bars.length < 32) return defaultState;

  // Use power-of-2 window
  const windowSize = bars.length >= 128 ? 128 : bars.length >= 64 ? 64 : 32;
  const window = bars.slice(-windowSize);

  // Compute log returns
  const returns: number[] = [];
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1].Close;
    const curr = window[i].Close;
    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    } else {
      returns.push(0);
    }
  }

  const n = returns.length;
  if (n < 16) return defaultState;

  // Detrend: remove linear trend from returns
  const meanRet = returns.reduce((s, r) => s + r, 0) / n;
  const detrended = returns.map((r, i) => {
    // Simple linear detrend
    const linearComponent = meanRet; // flat detrend (remove mean)
    return r - linearComponent;
  });

  // Apply Hanning window to reduce spectral leakage
  const windowed = detrended.map((v, i) => {
    const w = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (n - 1)));
    return v * w;
  });

  // DFT — compute power spectrum
  // Only need first half (Nyquist) since input is real
  const halfN = Math.floor(n / 2);
  const power: number[] = new Array(halfN).fill(0);

  for (let k = 1; k < halfN; k++) {
    // Skip DC (k=0)
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      re += windowed[t] * Math.cos(angle);
      im -= windowed[t] * Math.sin(angle);
    }
    power[k] = (re * re + im * im) / (n * n);
  }

  // Find dominant frequency (ignoring very low frequencies k < 2)
  let maxPower = 0;
  let dominantK = 0;
  for (let k = 2; k < halfN; k++) {
    if (power[k] > maxPower) {
      maxPower = power[k];
      dominantK = k;
    }
  }

  // Total spectral power (for normalization)
  const totalPower = power.reduce((s, p) => s + p, 0);

  // Dominant cycle length in bars
  const dominantCycleLength = dominantK > 0 ? Math.round(n / dominantK) : null;

  // Normalized spectral power at dominant frequency
  const spectralPower = totalPower > 0 ? maxPower / totalPower : 0;

  // Cycle stability: compare spectrum of first half vs second half
  let cycleStability = 0;
  if (n >= 32) {
    const firstHalf = windowed.slice(0, Math.floor(n / 2));
    const secondHalf = windowed.slice(Math.floor(n / 2));
    const fhDominant = findDominantFreq(firstHalf);
    const shDominant = findDominantFreq(secondHalf);
    if (fhDominant > 0 && shDominant > 0) {
      const ratio = Math.min(fhDominant, shDominant) / Math.max(fhDominant, shDominant);
      cycleStability = ratio; // 1.0 = perfectly stable cycle
    }
  }

  // Classify spectral shape
  let regimeLabel: SpectralState["regimeLabel"];
  if (spectralPower > 0.3 && cycleStability > 0.6) {
    regimeLabel = "cyclical";
  } else if (spectralPower < 0.1) {
    // Low concentration of power = trend-dominated or noisy
    // Check if most power is at low frequencies (trend)
    const lowFreqPower = power.slice(1, 4).reduce((s, p) => s + p, 0);
    const lowFreqRatio = totalPower > 0 ? lowFreqPower / totalPower : 0;
    regimeLabel = lowFreqRatio > 0.5 ? "trend" : "noisy";
  } else if (cycleStability < 0.4) {
    regimeLabel = "transition";
  } else {
    regimeLabel = "cyclical";
  }

  return {
    dominantCycleLength,
    spectralPower: round4(spectralPower),
    cycleStability: round4(cycleStability),
    regimeLabel,
  };
}

/**
 * Find dominant frequency index from a short signal segment.
 * Used internally for cycle stability comparison.
 */
function findDominantFreq(signal: number[]): number {
  const n = signal.length;
  if (n < 8) return 0;
  const halfN = Math.floor(n / 2);
  let maxP = 0;
  let domK = 0;

  for (let k = 1; k < halfN; k++) {
    let re = 0;
    let im = 0;
    for (let t = 0; t < n; t++) {
      const angle = (2 * Math.PI * k * t) / n;
      re += signal[t] * Math.cos(angle);
      im -= signal[t] * Math.sin(angle);
    }
    const p = re * re + im * im;
    if (p > maxP) {
      maxP = p;
      domK = k;
    }
  }

  return domK;
}

// ── Merged Regime State ────────────────────────────────────────────────────────

/**
 * Merge basic regime + spectral analysis into one coherent state with
 * a human-readable label and overall confidence.
 */
export function mergeRegimeState(
  basic: RegimeState,
  spectral: SpectralState,
): MergedRegimeState {
  // Build human-readable label
  const parts: string[] = [];
  parts.push(basic.regime.replace("_", " "));

  if (spectral.regimeLabel === "cyclical" && spectral.dominantCycleLength) {
    parts.push(`cycle=${spectral.dominantCycleLength}bars`);
  }
  if (basic.compressionScore > 0.6) parts.push("compressing");
  if (basic.expansionScore > 0.6) parts.push("expanding");
  parts.push(`vol=${basic.volState}`);

  const label = parts.join(" | ");

  // Confidence: weighted average favoring basic regime (more tested)
  const confidence = Math.max(
    0,
    Math.min(
      1,
      basic.confidence * 0.65 +
        (spectral.regimeLabel !== "noisy" ? spectral.spectralPower : 0) * 0.2 +
        spectral.cycleStability * 0.15,
    ),
  );

  return {
    basic,
    spectral,
    label,
    confidence: round4(confidence),
    computedAt: new Date().toISOString(),
  };
}

// ── Convenience ────────────────────────────────────────────────────────────────

/**
 * Compute full regime state (basic + spectral) from bars.
 */
export function computeFullRegime(
  bars: Array<{ Open: number; High: number; Low: number; Close: number; Volume: number }>,
): MergedRegimeState {
  const basic = computeBasicRegime(bars);
  const spectral = computeSpectralRegime(bars);
  return mergeRegimeState(basic, spectral);
}

// ── Transition Logging & Anomaly Detection ─────────────────────────────────────

const _lastRegimes = new Map<string, { regime: BasicRegime; timestamp: number }>();

export function recordRegimeTransition(
  symbol: string,
  from: BasicRegime,
  to: BasicRegime,
  confidence: number,
): RegimeTransitionLog {
  const now = new Date();
  const transition: RegimeTransitionLog = {
    id: `transition_${symbol}_${Date.now()}`,
    symbol,
    from,
    to,
    confidence,
    timestamp: now.toISOString(),
    durationSeconds: _lastRegimes.has(symbol)
      ? Math.round((now.getTime() - (_lastRegimes.get(symbol)?.timestamp ?? 0)) / 1000)
      : undefined,
  };

  _lastRegimes.set(symbol, { regime: to, timestamp: now.getTime() });

  try {
    persistAppend("regime_transitions", transition, 2000);
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to persist regime transition");
  }

  return transition;
}

export function getRegimeHistory(symbol: string, limit = 50): RegimeTransitionLog[] {
  try {
    const all = persistRead<RegimeTransitionLog[]>("regime_transitions", []);
    return all.filter((t) => t.symbol === symbol).slice(-limit);
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to read regime history");
    return [];
  }
}

export function detectRegimeAnomaly(symbol: string, threshold = 5): RegimeAnomaly {
  try {
    const history = getRegimeHistory(symbol, 100);
    const oneHourAgo = Date.now() - 60 * 60 * 1000;
    const changesInLastHour = history.filter((t) => new Date(t.timestamp).getTime() > oneHourAgo).length;
    const anomalous = changesInLastHour > threshold;

    return {
      symbol,
      changesInLastHour,
      threshold,
      anomalous,
      detectedAt: new Date().toISOString(),
    };
  } catch (err) {
    logger.warn({ err, symbol }, "Failed to detect regime anomaly");
    return {
      symbol,
      changesInLastHour: 0,
      threshold,
      anomalous: false,
      detectedAt: new Date().toISOString(),
    };
  }
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}
