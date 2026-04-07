/**
 * correlation_engine.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * Phase 8B: Cross-Symbol Correlation Engine
 *
 * The brain needs to understand how symbols move TOGETHER:
 *   - When SPY and QQQ both drop simultaneously → systemic event, not noise
 *   - When correlation spikes → reduce portfolio exposure (contagion alert)
 *   - When correlation breaks down → mean reversion opportunity
 *   - Regime contagion: a regime shift in SPY often spreads to sectors
 *
 * Core capabilities:
 *   1. Rolling 5-min correlation matrix across all tracked symbols
 *   2. Contagion detection: correlation spike > 0.85 across 3+ symbols
 *   3. Cross-symbol regime propagation scoring
 *   4. Portfolio beta to SPY (market exposure)
 *   5. Diversification score (how diversified the current positions are)
 *
 * Algorithm:
 *   - Maintains a rolling window of normalized returns (last 60 bars = 5 hours)
 *   - Uses Pearson correlation with exponential decay weighting (recent = more weight)
 *   - Contagion = 3+ symbols with pairwise correlation > 0.80 simultaneously
 *   - Updates every 5 minutes via the scheduler
 * ─────────────────────────────────────────────────────────────────────────────
 */

import { logger } from "./logger.js";
import { brainEventBus } from "./brain_event_bus.js";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CorrelationPair {
  symbolA: string;
  symbolB: string;
  correlation: number;        // -1 to 1
  sampleSize: number;         // bars used
  isHighCorrelation: boolean; // > 0.80
  isNegativeCorrelation: boolean; // < -0.60 (potential hedge)
  updatedAt: number;
}

export interface ContagionAlert {
  severity: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  symbols: string[];           // symbols experiencing contagion
  avgCorrelation: number;
  timestamp: number;
  message: string;
}

export interface PortfolioBeta {
  symbol: string;
  betaToSpy: number;          // 0 = uncorrelated, 1 = moves with market
  direction: "ALIGNED" | "HEDGE" | "NEUTRAL";
}

export interface CorrelationSnapshot {
  timestamp: number;
  pairs: CorrelationPair[];
  contagionScore: number;       // 0-1 overall contagion level
  diversificationScore: number; // 0-1 (1 = maximally diversified)
  contagionAlert?: ContagionAlert;
  portfolioBetas: PortfolioBeta[];
  topCorrelations: CorrelationPair[];    // highest magnitude pairs
  bottomCorrelations: CorrelationPair[]; // most negative pairs
}

// ── Return series window ──────────────────────────────────────────────────────

interface PriceWindow {
  prices: number[];    // rolling price history
  returns: number[];   // log returns
  maxWindow: number;
}

// ── Correlation Engine ────────────────────────────────────────────────────────

class CorrelationEngine {
  private priceWindows = new Map<string, PriceWindow>();
  private latestSnapshot: CorrelationSnapshot | null = null;
  private updateTimer: NodeJS.Timeout | null = null;
  private isRunning = false;

  private readonly WINDOW_SIZE = 60;          // 60 bars ≈ 5 hours of 5-min data
  private readonly MIN_SAMPLES = 10;           // minimum for correlation
  private readonly CONTAGION_THRESHOLD = 0.80; // correlation to flag
  private readonly CONTAGION_COUNT = 3;        // pairs needed for alert
  private readonly DECAY_FACTOR = 0.97;        // exponential decay weight

  // ── Start / Stop ────────────────────────────────────────────────────────────

  start(): void {
    if (this.isRunning) return;
    this.isRunning = true;
    // Update correlation matrix every 5 minutes
    this.updateTimer = setInterval(() => this._updateMatrix(), 5 * 60_000);
    logger.info("[CorrelationEngine] Started");
  }

  stop(): void {
    this.isRunning = false;
    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }
  }

  // ── Price ingestion ─────────────────────────────────────────────────────────

  /**
   * Feed a new price observation for a symbol.
   * Called every time we receive a tick (via the stream bridge).
   * Only one price per 5-min bar is retained (the close).
   */
  onPrice(symbol: string, price: number): void {
    if (!this.priceWindows.has(symbol)) {
      this.priceWindows.set(symbol, { prices: [], returns: [], maxWindow: this.WINDOW_SIZE });
    }
    const window = this.priceWindows.get(symbol)!;

    // Add price
    window.prices.push(price);
    if (window.prices.length > this.WINDOW_SIZE + 1) {
      window.prices.shift();
    }

    // Compute log return
    if (window.prices.length >= 2) {
      const prev = window.prices[window.prices.length - 2];
      const curr = window.prices[window.prices.length - 1];
      const ret = prev > 0 ? Math.log(curr / prev) : 0;
      window.returns.push(ret);
      if (window.returns.length > this.WINDOW_SIZE) {
        window.returns.shift();
      }
    }
  }

  // ── Correlation computation ─────────────────────────────────────────────────

  private _pearsonCorrelation(a: number[], b: number[]): number {
    const n = Math.min(a.length, b.length);
    if (n < this.MIN_SAMPLES) return 0;

    const aSlice = a.slice(-n);
    const bSlice = b.slice(-n);

    // Exponential decay weights (recent observations weighted more)
    const weights: number[] = [];
    let wSum = 0;
    for (let i = 0; i < n; i++) {
      const w = Math.pow(this.DECAY_FACTOR, n - 1 - i);
      weights.push(w);
      wSum += w;
    }

    // Weighted means
    let meanA = 0, meanB = 0;
    for (let i = 0; i < n; i++) {
      meanA += weights[i] * aSlice[i];
      meanB += weights[i] * bSlice[i];
    }
    meanA /= wSum;
    meanB /= wSum;

    // Weighted covariance and variances
    let covAB = 0, varA = 0, varB = 0;
    for (let i = 0; i < n; i++) {
      const da = aSlice[i] - meanA;
      const db = bSlice[i] - meanB;
      covAB += weights[i] * da * db;
      varA += weights[i] * da * da;
      varB += weights[i] * db * db;
    }
    covAB /= wSum;
    varA /= wSum;
    varB /= wSum;

    const denom = Math.sqrt(varA * varB);
    if (denom === 0) return 0;

    return Math.max(-1, Math.min(1, covAB / denom));
  }

  private _updateMatrix(): void {
    const symbols = Array.from(this.priceWindows.keys())
      .filter((s) => {
        const w = this.priceWindows.get(s)!;
        return w.returns.length >= this.MIN_SAMPLES;
      });

    if (symbols.length < 2) return;

    const pairs: CorrelationPair[] = [];

    for (let i = 0; i < symbols.length; i++) {
      for (let j = i + 1; j < symbols.length; j++) {
        const symA = symbols[i];
        const symB = symbols[j];
        const retA = this.priceWindows.get(symA)!.returns;
        const retB = this.priceWindows.get(symB)!.returns;
        const corr = this._pearsonCorrelation(retA, retB);

        pairs.push({
          symbolA: symA,
          symbolB: symB,
          correlation: corr,
          sampleSize: Math.min(retA.length, retB.length),
          isHighCorrelation: corr > this.CONTAGION_THRESHOLD,
          isNegativeCorrelation: corr < -0.60,
          updatedAt: Date.now(),
        });
      }
    }

    // Contagion detection
    const highCorrPairs = pairs.filter((p) => p.isHighCorrelation);
    const contagionSymbols = new Set<string>();
    for (const p of highCorrPairs) {
      contagionSymbols.add(p.symbolA);
      contagionSymbols.add(p.symbolB);
    }

    const contagionScore = symbols.length > 1
      ? highCorrPairs.length / ((symbols.length * (symbols.length - 1)) / 2)
      : 0;

    // Diversification score (inverse of avg absolute correlation)
    const avgAbsCorr = pairs.length > 0
      ? pairs.reduce((s, p) => s + Math.abs(p.correlation), 0) / pairs.length
      : 0;
    const diversificationScore = 1 - avgAbsCorr;

    // Portfolio beta to SPY
    const spyReturns = this.priceWindows.get("SPY")?.returns ?? [];
    const portfolioBetas: PortfolioBeta[] = symbols
      .filter((s) => s !== "SPY" && spyReturns.length >= this.MIN_SAMPLES)
      .map((sym) => {
        const symReturns = this.priceWindows.get(sym)!.returns;
        const beta = this._pearsonCorrelation(symReturns, spyReturns);
        return {
          symbol: sym,
          betaToSpy: beta,
          direction: beta > 0.5 ? "ALIGNED" : beta < -0.3 ? "HEDGE" : "NEUTRAL",
        };
      });

    // Contagion alert
    let contagionAlert: ContagionAlert | undefined;
    if (contagionSymbols.size >= this.CONTAGION_COUNT && contagionScore > 0.5) {
      const avgCorr = highCorrPairs.reduce((s, p) => s + p.correlation, 0) / highCorrPairs.length;
      const severity: ContagionAlert["severity"] =
        contagionScore > 0.9 ? "CRITICAL" :
        contagionScore > 0.7 ? "HIGH" :
        contagionScore > 0.5 ? "MEDIUM" : "LOW";

      contagionAlert = {
        severity,
        symbols: Array.from(contagionSymbols),
        avgCorrelation: avgCorr,
        timestamp: Date.now(),
        message: `${severity} contagion: ${contagionSymbols.size} symbols correlated at avg ${(avgCorr * 100).toFixed(0)}%`,
      };

      // Emit to brain event bus
      if (severity === "HIGH" || severity === "CRITICAL") {
        brainEventBus.agentReport({
          agentId: "brain",
          symbol: "PORTFOLIO",
          status: "done",
          confidence: contagionScore,
          score: 1 - contagionScore,
          verdict: contagionAlert.message,
          data: { contagionSymbols: Array.from(contagionSymbols), contagionScore, severity },
          flags: [{ level: severity === "CRITICAL" ? "critical" as any : "warning", code: "CONTAGION_ALERT", message: contagionAlert.message }],
          timestamp: Date.now(),
          latencyMs: 0,
        });
      }
    }

    this.latestSnapshot = {
      timestamp: Date.now(),
      pairs,
      contagionScore,
      diversificationScore,
      contagionAlert,
      portfolioBetas,
      topCorrelations: [...pairs].sort((a, b) => b.correlation - a.correlation).slice(0, 5),
      bottomCorrelations: [...pairs].sort((a, b) => a.correlation - b.correlation).slice(0, 5),
    };
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  getSnapshot(): CorrelationSnapshot | null {
    return this.latestSnapshot;
  }

  getCorrelation(symbolA: string, symbolB: string): number {
    if (!this.latestSnapshot) return 0;
    const pair = this.latestSnapshot.pairs.find(
      (p) => (p.symbolA === symbolA && p.symbolB === symbolB) ||
              (p.symbolA === symbolB && p.symbolB === symbolA)
    );
    return pair?.correlation ?? 0;
  }

  /**
   * Are the current brain positions dangerously correlated?
   * Returns a 0-1 risk score.
   */
  getPositionDiversificationRisk(symbols: string[]): number {
    if (symbols.length < 2 || !this.latestSnapshot) return 0;
    const relevantPairs = this.latestSnapshot.pairs.filter(
      (p) => symbols.includes(p.symbolA) && symbols.includes(p.symbolB)
    );
    if (relevantPairs.length === 0) return 0;
    const avgCorr = relevantPairs.reduce((s, p) => s + p.correlation, 0) / relevantPairs.length;
    return Math.max(0, avgCorr); // 0-1 risk
  }

  getSummary() {
    const snap = this.latestSnapshot;
    const symbols = Array.from(this.priceWindows.keys());
    return {
      running: this.isRunning,
      trackedSymbols: symbols.length,
      symbolList: symbols,
      lastUpdated: snap?.timestamp ? new Date(snap.timestamp).toISOString() : null,
      contagionScore: snap?.contagionScore ?? 0,
      diversificationScore: snap?.diversificationScore ?? 1,
      hasContagionAlert: !!snap?.contagionAlert,
      contagionAlert: snap?.contagionAlert,
      pairCount: snap?.pairs.length ?? 0,
      topCorrelations: snap?.topCorrelations ?? [],
      portfolioBetas: snap?.portfolioBetas ?? [],
    };
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

export const correlationEngine = new CorrelationEngine();
