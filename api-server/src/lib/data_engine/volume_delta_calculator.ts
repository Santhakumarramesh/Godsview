/**
 * Phase 93 — Volume Delta Calculator
 *
 * Classifies trades as buy/sell, computes cumulative volume delta (CVD),
 * footprint charts, and imbalance detection across timeframes.
 */

export interface TradeTickInput {
  symbol: string;
  ts: Date;
  price: number;
  size: number;
  side?: "buy" | "sell" | "unknown";
}

export interface VolumeDeltaBar {
  symbol: string;
  timeframe: string;
  barTime: Date;
  buyVolume: number;
  sellVolume: number;
  delta: number;
  cumulativeDelta: number;
  deltaPercent: number;
  maxSingleTrade: number;
  tradeCount: number;
  aggressiveBuyPct: number;
  aggressiveSellPct: number;
}

export interface FootprintLevel {
  priceLevel: number;
  bidVolume: number;
  askVolume: number;
  delta: number;
  isPoc: boolean;
  isHighVolumeNode: boolean;
}

export interface FootprintBar {
  symbol: string;
  timeframe: string;
  barTime: Date;
  levels: FootprintLevel[];
  poc: number; // point of control price
  valueAreaHigh: number;
  valueAreaLow: number;
  totalDelta: number;
}

export interface ImbalanceAlert {
  symbol: string;
  ts: Date;
  type: "delta_divergence" | "absorption" | "exhaustion" | "iceberg" | "sweep";
  severity: "low" | "medium" | "high";
  direction: "bullish" | "bearish";
  description: string;
  priceLevel: number;
  delta: number;
}

interface BarAccumulator {
  buyVolume: number;
  sellVolume: number;
  maxSingleTrade: number;
  tradeCount: number;
  aggressiveBuys: number;
  aggressiveSells: number;
  footprint: Map<number, { bidVol: number; askVol: number }>;
  lastPrice: number;
}

const TIMEFRAME_MS: Record<string, number> = {
  "1m": 60_000,
  "5m": 300_000,
  "15m": 900_000,
  "1h": 3_600_000,
  "4h": 14_400_000,
  "1d": 86_400_000,
};

export class VolumeDeltaCalculator {
  private accumulators: Map<string, BarAccumulator> = new Map();
  private cumulativeDeltas: Map<string, number> = new Map();
  private currentBarTimes: Map<string, number> = new Map();
  private tickSize: number;
  private completedBars: VolumeDeltaBar[] = [];
  private alerts: ImbalanceAlert[] = [];
  private recentDeltas: Map<string, number[]> = new Map();

  constructor(
    private symbol: string,
    private timeframes: string[] = ["1m", "5m", "15m"],
    tickSize = 0.01
  ) {
    this.tickSize = tickSize;
    for (const tf of timeframes) {
      const key = `${symbol}:${tf}`;
      this.accumulators.set(key, this.newAccumulator());
      this.cumulativeDeltas.set(key, 0);
      this.recentDeltas.set(key, []);
    }
  }

  private newAccumulator(): BarAccumulator {
    return {
      buyVolume: 0,
      sellVolume: 0,
      maxSingleTrade: 0,
      tradeCount: 0,
      aggressiveBuys: 0,
      aggressiveSells: 0,
      footprint: new Map(),
      lastPrice: 0,
    };
  }

  /** Process a single trade tick */
  processTick(tick: TradeTickInput): { completedBars: VolumeDeltaBar[]; alerts: ImbalanceAlert[] } {
    const newBars: VolumeDeltaBar[] = [];
    const newAlerts: ImbalanceAlert[] = [];

    for (const tf of this.timeframes) {
      const key = `${this.symbol}:${tf}`;
      const tfMs = TIMEFRAME_MS[tf] ?? 60_000;
      const barTime = Math.floor(tick.ts.getTime() / tfMs) * tfMs;
      const currentBarTime = this.currentBarTimes.get(key);

      // Bar rollover
      if (currentBarTime !== undefined && barTime > currentBarTime) {
        const completed = this.finalizeBar(key, tf, new Date(currentBarTime));
        if (completed) {
          newBars.push(completed);
          this.completedBars.push(completed);

          // Check for alerts
          const alert = this.detectImbalances(completed);
          if (alert) {
            newAlerts.push(alert);
            this.alerts.push(alert);
          }
        }
        this.accumulators.set(key, this.newAccumulator());
      }
      this.currentBarTimes.set(key, barTime);

      // Accumulate tick
      const acc = this.accumulators.get(key)!;
      const isBuy = tick.side === "buy" || (tick.side === "unknown" && tick.price >= acc.lastPrice);

      if (isBuy) {
        acc.buyVolume += tick.size;
        acc.aggressiveBuys++;
      } else {
        acc.sellVolume += tick.size;
        acc.aggressiveSells++;
      }

      acc.maxSingleTrade = Math.max(acc.maxSingleTrade, tick.size);
      acc.tradeCount++;
      acc.lastPrice = tick.price;

      // Footprint accumulation
      const priceLevel = Math.round(tick.price / this.tickSize) * this.tickSize;
      const fp = acc.footprint.get(priceLevel) ?? { bidVol: 0, askVol: 0 };
      if (isBuy) fp.askVol += tick.size;
      else fp.bidVol += tick.size;
      acc.footprint.set(priceLevel, fp);
    }

    return { completedBars: newBars, alerts: newAlerts };
  }

  /** Finalize a bar and compute all metrics */
  private finalizeBar(key: string, timeframe: string, barTime: Date): VolumeDeltaBar | null {
    const acc = this.accumulators.get(key);
    if (!acc || acc.tradeCount === 0) return null;

    const delta = acc.buyVolume - acc.sellVolume;
    const prevCd = this.cumulativeDeltas.get(key) ?? 0;
    const cumulativeDelta = prevCd + delta;
    this.cumulativeDeltas.set(key, cumulativeDelta);

    const totalVolume = acc.buyVolume + acc.sellVolume;
    const totalAggressive = acc.aggressiveBuys + acc.aggressiveSells;

    const bar: VolumeDeltaBar = {
      symbol: this.symbol,
      timeframe,
      barTime,
      buyVolume: acc.buyVolume,
      sellVolume: acc.sellVolume,
      delta,
      cumulativeDelta,
      deltaPercent: totalVolume > 0 ? (delta / totalVolume) * 100 : 0,
      maxSingleTrade: acc.maxSingleTrade,
      tradeCount: acc.tradeCount,
      aggressiveBuyPct: totalAggressive > 0 ? acc.aggressiveBuys / totalAggressive : 0,
      aggressiveSellPct: totalAggressive > 0 ? acc.aggressiveSells / totalAggressive : 0,
    };

    // Track recent deltas for divergence detection
    const recent = this.recentDeltas.get(key) ?? [];
    recent.push(delta);
    if (recent.length > 20) recent.shift();
    this.recentDeltas.set(key, recent);

    return bar;
  }

  /** Build footprint chart for a given timeframe key */
  buildFootprint(key: string, timeframe: string, barTime: Date): FootprintBar | null {
    const acc = this.accumulators.get(key);
    if (!acc || acc.footprint.size === 0) return null;

    const levels: FootprintLevel[] = [];
    let maxVolume = 0;
    let pocPrice = 0;
    let pocVolume = 0;

    for (const [price, vol] of acc.footprint) {
      const totalVol = vol.bidVol + vol.askVol;
      if (totalVol > pocVolume) {
        pocVolume = totalVol;
        pocPrice = price;
      }
      maxVolume = Math.max(maxVolume, totalVol);
      levels.push({
        priceLevel: price,
        bidVolume: vol.bidVol,
        askVolume: vol.askVol,
        delta: vol.askVol - vol.bidVol,
        isPoc: false,
        isHighVolumeNode: false,
      });
    }

    // Mark POC and high volume nodes
    const hvnThreshold = maxVolume * 0.7;
    for (const level of levels) {
      const totalVol = level.bidVolume + level.askVolume;
      if (level.priceLevel === pocPrice) level.isPoc = true;
      if (totalVol >= hvnThreshold) level.isHighVolumeNode = true;
    }

    levels.sort((a, b) => a.priceLevel - b.priceLevel);

    // Value area (70% of volume around POC)
    const totalVolume = levels.reduce((s, l) => s + l.bidVolume + l.askVolume, 0);
    const vaTarget = totalVolume * 0.7;
    let vaVolume = 0;
    let vaHigh = pocPrice;
    let vaLow = pocPrice;
    const pocIdx = levels.findIndex((l) => l.isPoc);
    let hiIdx = pocIdx;
    let loIdx = pocIdx;

    while (vaVolume < vaTarget && (hiIdx < levels.length - 1 || loIdx > 0)) {
      const hiCandidate = hiIdx < levels.length - 1 ? levels[hiIdx + 1] : null;
      const loCandidate = loIdx > 0 ? levels[loIdx - 1] : null;
      const hiVol = hiCandidate ? hiCandidate.bidVolume + hiCandidate.askVolume : 0;
      const loVol = loCandidate ? loCandidate.bidVolume + loCandidate.askVolume : 0;

      if (hiVol >= loVol && hiCandidate) {
        hiIdx++;
        vaVolume += hiVol;
        vaHigh = hiCandidate.priceLevel;
      } else if (loCandidate) {
        loIdx--;
        vaVolume += loVol;
        vaLow = loCandidate.priceLevel;
      } else break;
    }

    const totalDelta = levels.reduce((s, l) => s + l.delta, 0);

    return {
      symbol: this.symbol,
      timeframe,
      barTime,
      levels,
      poc: pocPrice,
      valueAreaHigh: vaHigh,
      valueAreaLow: vaLow,
      totalDelta,
    };
  }

  /** Detect imbalance conditions */
  private detectImbalances(bar: VolumeDeltaBar): ImbalanceAlert | null {
    const key = `${this.symbol}:${bar.timeframe}`;
    const recent = this.recentDeltas.get(key) ?? [];

    if (recent.length < 5) return null;

    // Exhaustion: extreme delta followed by reversal
    const lastFew = recent.slice(-5);
    const avgDelta = lastFew.reduce((a, b) => a + b, 0) / lastFew.length;
    const currentDelta = bar.delta;

    if (Math.abs(currentDelta) > Math.abs(avgDelta) * 3) {
      return {
        symbol: this.symbol,
        ts: bar.barTime,
        type: "exhaustion",
        severity: "high",
        direction: currentDelta > 0 ? "bullish" : "bearish",
        description: `Extreme delta spike: ${currentDelta.toFixed(0)} vs avg ${avgDelta.toFixed(0)}`,
        priceLevel: 0,
        delta: currentDelta,
      };
    }

    // Absorption: high volume but small delta (buyers and sellers matching)
    const totalVol = bar.buyVolume + bar.sellVolume;
    if (totalVol > 0 && Math.abs(bar.deltaPercent) < 5 && bar.tradeCount > 100) {
      return {
        symbol: this.symbol,
        ts: bar.barTime,
        type: "absorption",
        severity: "medium",
        direction: bar.delta > 0 ? "bullish" : "bearish",
        description: `High volume absorption: ${totalVol.toFixed(0)} volume, ${bar.deltaPercent.toFixed(1)}% delta`,
        priceLevel: 0,
        delta: bar.delta,
      };
    }

    return null;
  }

  /** Get all completed bars */
  getCompletedBars(): VolumeDeltaBar[] {
    return [...this.completedBars];
  }

  /** Get all alerts */
  getAlerts(): ImbalanceAlert[] {
    return [...this.alerts];
  }

  /** Get current cumulative delta */
  getCumulativeDelta(timeframe: string): number {
    return this.cumulativeDeltas.get(`${this.symbol}:${timeframe}`) ?? 0;
  }

  /** Reset state */
  reset(): void {
    this.accumulators.clear();
    this.cumulativeDeltas.clear();
    this.currentBarTimes.clear();
    this.completedBars = [];
    this.alerts = [];
    this.recentDeltas.clear();
    for (const tf of this.timeframes) {
      const key = `${this.symbol}:${tf}`;
      this.accumulators.set(key, this.newAccumulator());
      this.cumulativeDeltas.set(key, 0);
      this.recentDeltas.set(key, []);
    }
  }
}
