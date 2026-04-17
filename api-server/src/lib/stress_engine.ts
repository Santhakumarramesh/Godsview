/**
 * stress_engine.ts — Volatility / Stress Engine
 *
 * Cross-symbol market danger and systemic pressure engine:
 *   - Per-symbol volatility state (realized vol, ATR, vol-of-vol, jump detection)
 *   - Cross-symbol correlation matrix and systemic stress scoring
 *   - Stress propagation detection (isolated → sector → broad → contagion)
 *
 * All functions are pure — no I/O, no side effects.
 */

// ── Types ──────────────────────────────────────────────────────────────────────

export interface VolatilityState {
  symbol: string;
  /** Annualized realized volatility from returns */
  realizedVol: number;
  /** Average True Range as % of price */
  atrPct: number;
  /** Volatility of volatility — how unstable is vol itself */
  volOfVol: number;
  /** Largest single-bar absolute return / avg return ratio */
  jumpScore: number;
  /** Range expansion ratio: recent ATR / historical ATR */
  rangeExpansion: number;
  /** Classified regime */
  volRegime: "calm" | "normal" | "elevated" | "extreme";
}

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number;
}

export interface MarketStressState {
  /** Average pairwise correlation across all tracked symbols */
  avgCorrelation: number;
  /** Number of pairs with correlation > 0.7 (spiking together) */
  correlationSpikeCount: number;
  /** % of symbols with negative recent returns (breadth weakness) */
  breadthWeakness: number;
  /** Composite systemic stress score 0-1 */
  systemicStressScore: number;
  /** Classified stress regime */
  stressRegime: "low" | "moderate" | "high" | "crash_risk";
  /** Number of symbols analyzed */
  symbolCount: number;
  /** Top correlated pairs */
  topCorrelations: CorrelationPair[];
  computedAt: string;
}

export type StressPropagation =
  | "isolated"
  | "sector_stress"
  | "broad_market"
  | "contagion";

export interface StressPropagationState {
  level: StressPropagation;
  /** % of symbols in drawdown */
  drawdownBreadth: number;
  /** Average drawdown depth */
  avgDrawdownPct: number;
  /** Whether vol is rising across the board */
  volRising: boolean;
  /** Narrative description */
  narrative: string;
}

// ── Per-Symbol Volatility ──────────────────────────────────────────────────────

/**
 * Compute detailed volatility state for a single symbol.
 */
export function computeVolatilityState(
  symbol: string,
  bars: Array<{ Open: number; High: number; Low: number; Close: number }>,
): VolatilityState {
  const defaultState: VolatilityState = {
    symbol,
    realizedVol: 0,
    atrPct: 0,
    volOfVol: 0,
    jumpScore: 0,
    rangeExpansion: 1,
    volRegime: "normal",
  };

  if (bars.length < 20) return defaultState;

  // Log returns
  const returns: number[] = [];
  for (let i = 1; i < bars.length; i++) {
    const prev = bars[i - 1].Close;
    const curr = bars[i].Close;
    if (prev > 0 && curr > 0) {
      returns.push(Math.log(curr / prev));
    }
  }

  if (returns.length < 14) return defaultState;

  // Realized volatility (annualized from 1-min bars: sqrt(252 * 390) ≈ 313.5)
  const meanRet = returns.reduce((s, r) => s + r, 0) / returns.length;
  const variance =
    returns.reduce((s, r) => s + (r - meanRet) ** 2, 0) / (returns.length - 1);
  const dailyVol = Math.sqrt(variance);
  // Annualize: assume ~390 1-min bars per day, 252 trading days
  const annualFactor =
    bars.length > 50 ? Math.sqrt(252 * 390) : Math.sqrt(252 * 78); // adjust for 5m
  const realizedVol = dailyVol * annualFactor;

  // ATR as % of price
  const atrBars = bars.slice(-14);
  let atrSum = 0;
  for (let i = 1; i < atrBars.length; i++) {
    const tr = Math.max(
      atrBars[i].High - atrBars[i].Low,
      Math.abs(atrBars[i].High - atrBars[i - 1].Close),
      Math.abs(atrBars[i].Low - atrBars[i - 1].Close),
    );
    atrSum += tr;
  }
  const atr = atrSum / Math.max(atrBars.length - 1, 1);
  const lastClose = bars[bars.length - 1].Close;
  const atrPct = lastClose > 0 ? atr / lastClose : 0;

  // Vol-of-vol: rolling 5-bar realized vol, then std of that series
  const rollingVols: number[] = [];
  for (let i = 5; i < returns.length; i++) {
    const window = returns.slice(i - 5, i);
    const wMean = window.reduce((s, r) => s + r, 0) / 5;
    const wVar = window.reduce((s, r) => s + (r - wMean) ** 2, 0) / 4;
    rollingVols.push(Math.sqrt(wVar));
  }
  const volMean =
    rollingVols.length > 0
      ? rollingVols.reduce((s, v) => s + v, 0) / rollingVols.length
      : 0;
  const volVariance =
    rollingVols.length > 1
      ? rollingVols.reduce((s, v) => s + (v - volMean) ** 2, 0) /
        (rollingVols.length - 1)
      : 0;
  const volOfVol = volMean > 0 ? Math.sqrt(volVariance) / volMean : 0;

  // Jump score: largest single-bar absolute return / average absolute return
  const absReturns = returns.map((r) => Math.abs(r));
  const avgAbsRet =
    absReturns.reduce((s, r) => s + r, 0) / absReturns.length;
  const maxAbsRet = Math.max(...absReturns);
  const jumpScore = avgAbsRet > 0 ? maxAbsRet / avgAbsRet : 0;

  // Range expansion: recent 10-bar ATR vs full-window ATR
  const recentRanges = bars.slice(-10).map((b) => b.High - b.Low);
  const fullRanges = bars.map((b) => b.High - b.Low);
  const recentATR =
    recentRanges.reduce((s, r) => s + r, 0) / recentRanges.length;
  const fullATR = fullRanges.reduce((s, r) => s + r, 0) / fullRanges.length;
  const rangeExpansion = fullATR > 0 ? recentATR / fullATR : 1;

  // Classify vol regime
  let volRegime: VolatilityState["volRegime"];
  if (atrPct < 0.003 && rangeExpansion < 0.8) {
    volRegime = "calm";
  } else if (atrPct < 0.012 && rangeExpansion < 1.4) {
    volRegime = "normal";
  } else if (atrPct < 0.025 || rangeExpansion < 2.0) {
    volRegime = "elevated";
  } else {
    volRegime = "extreme";
  }

  return {
    symbol,
    realizedVol: round4(realizedVol),
    atrPct: round6(atrPct),
    volOfVol: round4(volOfVol),
    jumpScore: round4(Math.min(jumpScore, 10)),
    rangeExpansion: round4(rangeExpansion),
    volRegime,
  };
}

// ── Cross-Symbol Correlation & Stress ──────────────────────────────────────────

/**
 * Compute market stress state from multiple symbols' return series.
 *
 * @param symbolReturns Map of symbol → array of log returns (same length, aligned)
 */
export function computeMarketStress(
  symbolReturns: Map<string, number[]>,
): MarketStressState {
  const symbols = Array.from(symbolReturns.keys());
  const n = symbols.length;

  const defaultState: MarketStressState = {
    avgCorrelation: 0,
    correlationSpikeCount: 0,
    breadthWeakness: 0,
    systemicStressScore: 0,
    stressRegime: "low",
    symbolCount: n,
    topCorrelations: [],
    computedAt: new Date().toISOString(),
  };

  if (n < 2) return defaultState;

  // Compute pairwise correlations
  const pairs: CorrelationPair[] = [];
  let totalCorr = 0;
  let pairCount = 0;
  let spikeCount = 0;

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const retA = symbolReturns.get(symbols[i])!;
      const retB = symbolReturns.get(symbols[j])!;
      const corr = pearsonCorrelation(retA, retB);

      if (Number.isFinite(corr)) {
        totalCorr += Math.abs(corr);
        pairCount++;
        if (Math.abs(corr) > 0.7) spikeCount++;

        pairs.push({
          symbolA: symbols[i],
          symbolB: symbols[j],
          correlation: round4(corr),
        });
      }
    }
  }

  const avgCorrelation = pairCount > 0 ? totalCorr / pairCount : 0;

  // Breadth weakness: % of symbols with negative total returns
  let negativeCount = 0;
  for (const [, returns] of symbolReturns) {
    const totalReturn = returns.reduce((s, r) => s + r, 0);
    if (totalReturn < 0) negativeCount++;
  }
  const breadthWeakness = n > 0 ? negativeCount / n : 0;

  // Top correlated pairs
  const topCorrelations = pairs
    .sort((a, b) => Math.abs(b.correlation) - Math.abs(a.correlation))
    .slice(0, 10);

  // Systemic stress score: weighted composite
  const corrComponent = Math.min(1, avgCorrelation * 1.5); // high avg corr = stress
  const spikeComponent = Math.min(1, spikeCount / Math.max(pairCount * 0.3, 1));
  const breadthComponent = breadthWeakness;

  const systemicStressScore = Math.max(
    0,
    Math.min(
      1,
      corrComponent * 0.35 + spikeComponent * 0.35 + breadthComponent * 0.30,
    ),
  );

  // Classify stress regime
  let stressRegime: MarketStressState["stressRegime"];
  if (systemicStressScore < 0.25) stressRegime = "low";
  else if (systemicStressScore < 0.50) stressRegime = "moderate";
  else if (systemicStressScore < 0.75) stressRegime = "high";
  else stressRegime = "crash_risk";

  return {
    avgCorrelation: round4(avgCorrelation),
    correlationSpikeCount: spikeCount,
    breadthWeakness: round4(breadthWeakness),
    systemicStressScore: round4(systemicStressScore),
    stressRegime,
    symbolCount: n,
    topCorrelations,
    computedAt: new Date().toISOString(),
  };
}

// ── Stress Propagation ─────────────────────────────────────────────────────────

/**
 * Detect how stress is propagating across the market.
 *
 * @param symbolVols Map of symbol → current VolatilityState
 * @param symbolReturns Map of symbol → recent returns (for drawdown calc)
 */
export function detectStressPropagation(
  symbolVols: Map<string, VolatilityState>,
  symbolReturns: Map<string, number[]>,
): StressPropagationState {
  const symbols = Array.from(symbolVols.keys());
  const n = symbols.length;

  if (n === 0) {
    return {
      level: "isolated",
      drawdownBreadth: 0,
      avgDrawdownPct: 0,
      volRising: false,
      narrative: "No symbols to analyze",
    };
  }

  // Count symbols in drawdown (negative returns) and elevated vol
  let drawdownCount = 0;
  let totalDrawdownPct = 0;
  let elevatedVolCount = 0;

  for (const symbol of symbols) {
    const returns = symbolReturns.get(symbol) ?? [];
    const totalReturn = returns.reduce((s, r) => s + r, 0);
    if (totalReturn < -0.005) {
      // > 0.5% drawdown
      drawdownCount++;
      totalDrawdownPct += Math.abs(totalReturn);
    }

    const vol = symbolVols.get(symbol);
    if (vol && (vol.volRegime === "elevated" || vol.volRegime === "extreme")) {
      elevatedVolCount++;
    }
  }

  const drawdownBreadth = n > 0 ? drawdownCount / n : 0;
  const avgDrawdownPct =
    drawdownCount > 0 ? totalDrawdownPct / drawdownCount : 0;
  const volRising = elevatedVolCount / Math.max(n, 1) > 0.5;

  // Propagation level
  let level: StressPropagation;
  let narrative: string;

  if (drawdownBreadth < 0.2 && !volRising) {
    level = "isolated";
    narrative = `Market stable — only ${drawdownCount}/${n} symbols in drawdown`;
  } else if (drawdownBreadth < 0.4) {
    level = "sector_stress";
    narrative = `Sector-level stress — ${Math.round(drawdownBreadth * 100)}% of symbols declining, avg drawdown ${(avgDrawdownPct * 100).toFixed(1)}%`;
  } else if (drawdownBreadth < 0.7 || !volRising) {
    level = "broad_market";
    narrative = `Broad market stress — ${Math.round(drawdownBreadth * 100)}% declining${volRising ? ", volatility rising across board" : ""}`;
  } else {
    level = "contagion";
    narrative = `Contagion risk — ${Math.round(drawdownBreadth * 100)}% in drawdown, vol elevated in ${elevatedVolCount}/${n} symbols`;
  }

  return {
    level,
    drawdownBreadth: round4(drawdownBreadth),
    avgDrawdownPct: round4(avgDrawdownPct),
    volRising,
    narrative,
  };
}

// ── Helpers ────────────────────────────────────────────────────────────────────

/**
 * Pearson correlation coefficient between two arrays.
 * Returns NaN if either array has zero variance.
 */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 5) return NaN;

  const aa = a.slice(-n);
  const bb = b.slice(-n);

  const meanA = aa.reduce((s, v) => s + v, 0) / n;
  const meanB = bb.reduce((s, v) => s + v, 0) / n;

  let num = 0;
  let denA = 0;
  let denB = 0;

  for (let i = 0; i < n; i++) {
    const da = aa[i] - meanA;
    const db = bb[i] - meanB;
    num += da * db;
    denA += da * da;
    denB += db * db;
  }

  const den = Math.sqrt(denA * denB);
  return den > 0 ? num / den : NaN;
}

function round4(n: number): number {
  return Math.round(n * 10000) / 10000;
}

function round6(n: number): number {
  return Math.round(n * 1000000) / 1000000;
}
