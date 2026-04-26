/**
 * scripts/backtest_regimes.ts — Reproducible 3-regime backtest proof
 *
 * Generates DETERMINISTIC synthetic OHLCV data for three market regimes,
 * runs a simple trend + mean-reversion strategy, and reports metrics +
 * train/test generalization gap.
 *
 * No external APIs. No randomness without a seed. Same seed → same results.
 * If Sharpe shifts on rerun, something is non-deterministic and broken.
 *
 *   pnpm tsx scripts/backtest_regimes.ts
 *
 * Outputs: docs/backtests/regime_proof_<regime>.json (one per regime)
 */

import * as fs from "fs";
import * as path from "path";

// ─── Deterministic PRNG ─────────────────────────────────────────────────────
function mulberry32(seed: number) {
  let t = seed;
  return () => {
    t = (t + 0x6d2b79f5) | 0;
    let r = Math.imul(t ^ (t >>> 15), 1 | t);
    r = (r + Math.imul(r ^ (r >>> 7), 61 | r)) ^ r;
    return ((r ^ (r >>> 14)) >>> 0) / 4294967296;
  };
}

// Box-Muller transform for normally-distributed noise
function gaussian(prng: () => number): number {
  const u = Math.max(prng(), 1e-9);
  const v = prng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

// ─── Regime data generators ─────────────────────────────────────────────────
type Bar = { t: number; open: number; high: number; low: number; close: number; volume: number };

function genTrending(seed: number, bars: number, drift: number): Bar[] {
  const prng = mulberry32(seed);
  const sigma = 0.005;
  let p = 100;
  const out: Bar[] = [];
  for (let i = 0; i < bars; i++) {
    const ret = drift + sigma * gaussian(prng);
    const close = p * (1 + ret);
    const high = Math.max(p, close) * (1 + Math.abs(gaussian(prng)) * 0.002);
    const low = Math.min(p, close) * (1 - Math.abs(gaussian(prng)) * 0.002);
    out.push({ t: i, open: p, high, low, close, volume: 1_000_000 + Math.floor(prng() * 500_000) });
    p = close;
  }
  return out;
}

function genSideways(seed: number, bars: number): Bar[] {
  const prng = mulberry32(seed);
  const center = 100;
  const sigma = 0.004;
  const meanRev = 0.05;
  let p = center;
  const out: Bar[] = [];
  for (let i = 0; i < bars; i++) {
    const pull = (center - p) / center * meanRev;
    const ret = pull + sigma * gaussian(prng);
    const close = p * (1 + ret);
    const high = Math.max(p, close) * (1 + Math.abs(gaussian(prng)) * 0.0015);
    const low = Math.min(p, close) * (1 - Math.abs(gaussian(prng)) * 0.0015);
    out.push({ t: i, open: p, high, low, close, volume: 800_000 + Math.floor(prng() * 400_000) });
    p = close;
  }
  return out;
}

function genHighVol(seed: number, bars: number): Bar[] {
  const prng = mulberry32(seed);
  let p = 100;
  const out: Bar[] = [];
  for (let i = 0; i < bars; i++) {
    // Volatility regime: occasional shocks
    const shock = prng() < 0.05 ? gaussian(prng) * 0.03 : 0;
    const ret = 0.0001 + 0.012 * gaussian(prng) + shock;
    const close = Math.max(0.01, p * (1 + ret));
    const high = Math.max(p, close) * (1 + Math.abs(gaussian(prng)) * 0.005);
    const low = Math.min(p, close) * (1 - Math.abs(gaussian(prng)) * 0.005);
    out.push({ t: i, open: p, high, low, close, volume: 1_500_000 + Math.floor(prng() * 1_000_000) });
    p = close;
  }
  return out;
}

// ─── Strategy ───────────────────────────────────────────────────────────────
// Simple SMA crossover (10/30) with ATR-based stops, trade only one position at a time.
type Trade = {
  entryBar: number;
  exitBar: number;
  side: "long" | "short";
  entry: number;
  exit: number;
  pnlR: number; // P&L in R-multiples
};

function sma(values: number[], n: number): (number | null)[] {
  const out: (number | null)[] = new Array(values.length).fill(null);
  let sum = 0;
  for (let i = 0; i < values.length; i++) {
    sum += values[i];
    if (i >= n) sum -= values[i - n];
    if (i >= n - 1) out[i] = sum / n;
  }
  return out;
}

function atr(bars: Bar[], n: number): (number | null)[] {
  const tr: number[] = new Array(bars.length);
  for (let i = 0; i < bars.length; i++) {
    if (i === 0) tr[i] = bars[i].high - bars[i].low;
    else {
      const prev = bars[i - 1].close;
      tr[i] = Math.max(
        bars[i].high - bars[i].low,
        Math.abs(bars[i].high - prev),
        Math.abs(bars[i].low - prev)
      );
    }
  }
  return sma(tr, n);
}

function runStrategy(bars: Bar[], opts: { fast: number; slow: number; atrN: number; atrMult: number; tpR: number }): Trade[] {
  const closes = bars.map((b) => b.close);
  const fast = sma(closes, opts.fast);
  const slow = sma(closes, opts.slow);
  const atrV = atr(bars, opts.atrN);

  const trades: Trade[] = [];
  let inPos: { side: "long" | "short"; entry: number; entryBar: number; stop: number; target: number } | null = null;

  for (let i = 1; i < bars.length; i++) {
    const f = fast[i], fp = fast[i - 1];
    const s = slow[i], sp = slow[i - 1];
    const a = atrV[i];
    const px = bars[i].close;

    // Manage open position
    if (inPos) {
      const hitStop = inPos.side === "long" ? bars[i].low <= inPos.stop : bars[i].high >= inPos.stop;
      const hitTarget = inPos.side === "long" ? bars[i].high >= inPos.target : bars[i].low <= inPos.target;
      let exitPrice: number | null = null;
      if (hitStop) exitPrice = inPos.stop;
      else if (hitTarget) exitPrice = inPos.target;
      if (exitPrice !== null) {
        const pnl = inPos.side === "long" ? exitPrice - inPos.entry : inPos.entry - exitPrice;
        const r = (inPos.entry - inPos.stop) * (inPos.side === "long" ? 1 : -1);
        const pnlR = r !== 0 ? pnl / Math.abs(r) : 0;
        trades.push({ entryBar: inPos.entryBar, exitBar: i, side: inPos.side, entry: inPos.entry, exit: exitPrice, pnlR });
        inPos = null;
      }
    }

    // Look for entry
    if (!inPos && f !== null && s !== null && fp !== null && sp !== null && a !== null && a > 0) {
      const crossUp = fp <= sp && f > s;
      const crossDn = fp >= sp && f < s;
      if (crossUp) {
        const stop = px - opts.atrMult * a;
        const target = px + opts.tpR * (px - stop);
        inPos = { side: "long", entry: px, entryBar: i, stop, target };
      } else if (crossDn) {
        const stop = px + opts.atrMult * a;
        const target = px - opts.tpR * (stop - px);
        inPos = { side: "short", entry: px, entryBar: i, stop, target };
      }
    }
  }

  return trades;
}

// ─── Metrics ────────────────────────────────────────────────────────────────
type Metrics = {
  trades: number;
  winRate: number;
  profitFactor: number;
  expectancy: number; // in R
  sharpe: number; // simple per-trade Sharpe
  maxDrawdownR: number;
  totalR: number;
};

function computeMetrics(trades: Trade[]): Metrics {
  if (trades.length === 0) {
    return { trades: 0, winRate: 0, profitFactor: 0, expectancy: 0, sharpe: 0, maxDrawdownR: 0, totalR: 0 };
  }
  const rs = trades.map((t) => t.pnlR);
  const wins = rs.filter((r) => r > 0);
  const losses = rs.filter((r) => r < 0);
  const grossWin = wins.reduce((a, b) => a + b, 0);
  const grossLoss = Math.abs(losses.reduce((a, b) => a + b, 0));
  const mean = rs.reduce((a, b) => a + b, 0) / rs.length;
  const variance = rs.reduce((acc, r) => acc + (r - mean) ** 2, 0) / Math.max(1, rs.length - 1);
  const std = Math.sqrt(variance);
  let peak = 0, eq = 0, maxDd = 0;
  for (const r of rs) {
    eq += r;
    if (eq > peak) peak = eq;
    const dd = peak - eq;
    if (dd > maxDd) maxDd = dd;
  }
  return {
    trades: rs.length,
    winRate: wins.length / rs.length,
    profitFactor: grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? Infinity : 0,
    expectancy: mean,
    sharpe: std > 0 ? (mean / std) * Math.sqrt(rs.length) : 0,
    maxDrawdownR: maxDd,
    totalR: eq,
  };
}

// ─── Driver ─────────────────────────────────────────────────────────────────
type RegimeName = "trending_up" | "trending_down" | "sideways" | "high_vol";

const SEED = 42;
const BARS = 2000;
const STRATEGY_OPTS = { fast: 10, slow: 30, atrN: 14, atrMult: 1.5, tpR: 2.0 };

function run(regime: RegimeName, bars: Bar[]) {
  const split = Math.floor(bars.length * 0.6);
  const train = bars.slice(0, split);
  const test = bars.slice(split);

  const trainTrades = runStrategy(train, STRATEGY_OPTS);
  const testTrades = runStrategy(test, STRATEGY_OPTS);
  const allTrades = runStrategy(bars, STRATEGY_OPTS);

  const trainMetrics = computeMetrics(trainTrades);
  const testMetrics = computeMetrics(testTrades);
  const allMetrics = computeMetrics(allTrades);

  const generalizationGap = {
    sharpeGap: trainMetrics.sharpe - testMetrics.sharpe,
    winRateGap: trainMetrics.winRate - testMetrics.winRate,
    expectancyGap: trainMetrics.expectancy - testMetrics.expectancy,
    testWorseThanTrain:
      testMetrics.sharpe < trainMetrics.sharpe &&
      testMetrics.expectancy < trainMetrics.expectancy,
  };

  return {
    regime,
    seed: SEED,
    bars: bars.length,
    strategy: { name: "sma_cross_atr_stops", ...STRATEGY_OPTS },
    train: { bars: train.length, ...trainMetrics },
    test: { bars: test.length, ...testMetrics },
    overall: { bars: bars.length, ...allMetrics },
    generalizationGap,
    timestamp: new Date().toISOString(),
  };
}

const outDir = path.resolve(__dirname, "..", "docs", "backtests", "regime_proof");
fs.mkdirSync(outDir, { recursive: true });

const results: any[] = [];

const trendingUp = genTrending(SEED, BARS, 0.0008);
results.push(run("trending_up", trendingUp));

const sideways = genSideways(SEED + 1, BARS);
results.push(run("sideways", sideways));

const highVol = genHighVol(SEED + 2, BARS);
results.push(run("high_vol", highVol));

const trendingDown = genTrending(SEED + 3, BARS, -0.0008);
results.push(run("trending_down", trendingDown));

for (const r of results) {
  const file = path.join(outDir, `${r.regime}.json`);
  fs.writeFileSync(file, JSON.stringify(r, null, 2));
}

const summary = {
  seed: SEED,
  bars_per_regime: BARS,
  generated_at: new Date().toISOString(),
  regimes: results.map((r) => ({
    regime: r.regime,
    trades: r.overall.trades,
    win_rate: +r.overall.winRate.toFixed(4),
    profit_factor: r.overall.profitFactor === Infinity ? "Infinity" : +r.overall.profitFactor.toFixed(3),
    expectancy_r: +r.overall.expectancy.toFixed(4),
    sharpe: +r.overall.sharpe.toFixed(3),
    max_dd_r: +r.overall.maxDrawdownR.toFixed(2),
    total_r: +r.overall.totalR.toFixed(2),
    test_worse_than_train: r.generalizationGap.testWorseThanTrain,
    sharpe_gap: +r.generalizationGap.sharpeGap.toFixed(3),
  })),
};

fs.writeFileSync(path.join(outDir, "summary.json"), JSON.stringify(summary, null, 2));

console.log(JSON.stringify(summary, null, 2));
console.log(`\nWrote ${results.length} regime reports + summary to ${outDir}`);
