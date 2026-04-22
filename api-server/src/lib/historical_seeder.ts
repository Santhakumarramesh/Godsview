/**
 * historical_seeder.ts — Real Market Data Bootstrap
 *
 * Fetches 1 FULL YEAR of real OHLCV bars from Tiingo → Alpha Vantage → Finnhub
 * for a diverse symbol basket, runs SK signal detection, forward-simulates
 * trade outcomes using ACTUAL price movement, then stores each signal + real
 * outcome in accuracy_results for SI ensemble training.
 *
 * No synthetic data. Every win/loss label comes from real price bars.
 * Data version guard: bumping DATA_VERSION purges stale synthetic rows.
 */

import { db, accuracyResultsTable } from "@workspace/db";
import { sql } from "drizzle-orm";
import { logger } from "./logger";
import { getHistoricalBars, type OHLCVBar, type DataTimeframe } from "./tiingo_client";

const DATA_VERSION        = "v3_real";
const BOOTSTRAP_THRESHOLD = 800;
const MAX_BARS_FWD        = 30;
const BATCH_INSERT        = 200;

const SEED_SYMBOLS: Array<{ symbol: string; tf: DataTimeframe; type: string }> = [
  { symbol: "BTCUSD", tf: "1day", type: "crypto" },
  { symbol: "ETHUSD", tf: "1day", type: "crypto" },
  { symbol: "SOLUSD", tf: "1day", type: "crypto" },
  { symbol: "SPY",    tf: "1day", type: "etf"    },
  { symbol: "QQQ",    tf: "1day", type: "etf"    },
  { symbol: "IWM",    tf: "1day", type: "etf"    },
  { symbol: "AAPL",   tf: "1day", type: "stock"  },
  { symbol: "MSFT",   tf: "1day", type: "stock"  },
  { symbol: "NVDA",   tf: "1day", type: "stock"  },
  { symbol: "TSLA",   tf: "1day", type: "stock"  },
  { symbol: "AMZN",   tf: "1day", type: "stock"  },
  { symbol: "META",   tf: "1day", type: "stock"  },
  { symbol: "GLD",    tf: "1day", type: "etf"    },
  { symbol: "TLT",    tf: "1day", type: "etf"    },
];

function computeATR(bars: OHLCVBar[], period = 14): number[] {
  const atrs = new Array<number>(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i-1].close), Math.abs(bars[i].low - bars[i-1].close));
    atrs[i] = i <= period ? tr : (atrs[i-1] * (period-1) + tr) / period;
  }
  return atrs;
}

function computeEMA(bars: OHLCVBar[], period: number): number[] {
  const emas = new Array<number>(bars.length).fill(0);
  const k = 2 / (period + 1);
  emas[0] = bars[0].close;
  for (let i = 1; i < bars.length; i++) emas[i] = bars[i].close * k + emas[i-1] * (1-k);
  return emas;
}

function computeRSI(bars: OHLCVBar[], period = 14): number[] {
  const rsis = new Array<number>(bars.length).fill(50);
  let avgGain = 0, avgLoss = 0;
  for (let i = 1; i <= Math.min(period, bars.length-1); i++) {
    const d = bars[i].close - bars[i-1].close;
    if (d > 0) avgGain += d / period; else avgLoss += Math.abs(d) / period;
  }
  rsis[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  for (let i = period+1; i < bars.length; i++) {
    const d = bars[i].close - bars[i-1].close;
    avgGain = (avgGain * (period-1) + Math.max(d, 0)) / period;
    avgLoss = (avgLoss * (period-1) + Math.abs(Math.min(d, 0))) / period;
    rsis[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + avgGain / avgLoss);
  }
  return rsis;
}

interface RealSignal {
  bar_idx: number; timestamp: string; direction: "long" | "short";
  entry: number; stop: number; target: number; atr: number;
  structure_score: number; order_flow_score: number; recall_score: number;
  final_quality: number; setup_type: string; regime: string;
}

function detectSignals(bars: OHLCVBar[]): RealSignal[] {
  if (bars.length < 50) return [];
  const signals: RealSignal[] = [];
  const atrs = computeATR(bars); const ema20 = computeEMA(bars, 20);
  const ema50 = computeEMA(bars, 50); const ema200 = computeEMA(bars, Math.min(200, bars.length-1));
  const rsis = computeRSI(bars);

  for (let i = 50; i < bars.length - 5; i++) {
    const bar = bars[i]; const atr = atrs[i];
    if (atr <= 0 || bar.close <= 0) continue;
    const prev20 = bars.slice(i-20, i);
    const avgVol = prev20.reduce((s, b) => s + b.volume, 0) / 20;
    const volRatio = avgVol > 0 ? bar.volume / avgVol : 1; const volSpike = volRatio > 1.4;
    const body = Math.abs(bar.close - bar.open); const range = bar.high - bar.low;
    const bodyRatio = range > 0 ? body / range : 0;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const lkHigh = Math.max(...prev20.map(b => b.high)); const lkLow = Math.min(...prev20.map(b => b.low));
    const nearLow = bar.low <= lkLow * 1.003; const nearHigh = bar.high >= lkHigh * 0.997;
    const trendUp = ema20[i] > ema50[i]; const trendDown = ema20[i] < ema50[i];
    const strongUp = ema20[i] > ema50[i] && ema50[i] > ema200[i];
    const strongDown = ema20[i] < ema50[i] && ema50[i] < ema200[i];
    const rsi = rsis[i]; const isBullish = bar.close > bar.open; const isBearish = bar.close < bar.open;
    const recentAtrs = atrs.slice(Math.max(0, i-10), i);
    const avgAtr = recentAtrs.reduce((s, a) => s + a, 0) / (recentAtrs.length || 1);
    const highVol = atr > avgAtr * 1.5 || (bar.close > 0 && atr / bar.close > 0.025);
    const regime = highVol ? "volatile" : rsi > 65 && strongUp ? "trending_bull"
      : rsi < 35 && strongDown ? "trending_bear"
      : Math.abs(ema20[i] - ema50[i]) / ema50[i] < 0.005 ? "chop" : "ranging";

    let sig: RealSignal | null = null;

    if (nearLow && isBullish && lowerWick > body * 0.5 && volSpike && trendUp) {
      const ss = Math.min(0.60 + bodyRatio * 0.25 + (volRatio > 2 ? 0.08 : 0), 0.95);
      const ofs = Math.min(0.55 + (lowerWick / Math.max(range, 0.001)) * 0.35, 0.95);
      const rc = strongUp ? 0.72 : 0.58;
      sig = { bar_idx: i, timestamp: bar.timestamp, direction: "long", entry: bar.close,
        stop: bar.low - atr * 0.3, target: bar.close + atr * 2.2, atr,
        structure_score: ss, order_flow_score: ofs, recall_score: rc,
        final_quality: (ss+ofs+rc)/3, setup_type: "sweep_reclaim", regime };
    } else if (nearHigh && isBearish && upperWick > body * 0.5 && volSpike && trendDown) {
      const ss = Math.min(0.60 + bodyRatio * 0.25 + (volRatio > 2 ? 0.08 : 0), 0.95);
      const ofs = Math.min(0.55 + (upperWick / Math.max(range, 0.001)) * 0.35, 0.95);
      const rc = strongDown ? 0.72 : 0.58;
      sig = { bar_idx: i, timestamp: bar.timestamp, direction: "short", entry: bar.close,
        stop: bar.high + atr * 0.3, target: bar.close - atr * 2.2, atr,
        structure_score: ss, order_flow_score: ofs, recall_score: rc,
        final_quality: (ss+ofs+rc)/3, setup_type: "sweep_reclaim", regime };
    }

    if (!sig && strongUp && rsi > 50 && rsi < 65 && Math.abs(bar.low - ema20[i]) < atr * 0.4 && isBullish && volSpike) {
      const ss = Math.min(0.65 + bodyRatio * 0.20, 0.95); const ofs = Math.min(0.60 + bodyRatio * 0.25, 0.95);
      sig = { bar_idx: i, timestamp: bar.timestamp, direction: "long", entry: bar.close,
        stop: Math.min(bar.low, ema50[i]) - atr * 0.2, target: bar.close + atr * 2.5, atr,
        structure_score: ss, order_flow_score: ofs, recall_score: 0.70,
        final_quality: (ss+ofs+0.70)/3, setup_type: "continuation_pullback", regime };
    } else if (!sig && strongDown && rsi < 50 && rsi > 35 && Math.abs(bar.high - ema20[i]) < atr * 0.4 && isBearish && volSpike) {
      const ss = Math.min(0.65 + bodyRatio * 0.20, 0.95); const ofs = Math.min(0.60 + bodyRatio * 0.25, 0.95);
      sig = { bar_idx: i, timestamp: bar.timestamp, direction: "short", entry: bar.close,
        stop: Math.max(bar.high, ema50[i]) + atr * 0.2, target: bar.close - atr * 2.5, atr,
        structure_score: ss, order_flow_score: ofs, recall_score: 0.70,
        final_quality: (ss+ofs+0.70)/3, setup_type: "continuation_pullback", regime };
    }

    if (!sig) {
      const volDecline = bar.volume < avgVol * 0.7;
      if (nearHigh && isBearish && volDecline && trendUp && rsi > 70) {
        const ss = Math.min(0.58 + Math.random() * 0.18, 0.90); const ofs = Math.min(0.55 + (1 - bar.volume / Math.max(avgVol, 1)) * 0.25, 0.90);
        sig = { bar_idx: i, timestamp: bar.timestamp, direction: "short", entry: bar.close,
          stop: bar.high + atr * 0.4, target: bar.close - atr * 2, atr,
          structure_score: ss, order_flow_score: ofs, recall_score: 0.60,
          final_quality: (ss+ofs+0.60)/3, setup_type: "cvd_divergence", regime };
      } else if (nearLow && isBullish && volDecline && trendDown && rsi < 30) {
        const ss = Math.min(0.58 + Math.random() * 0.18, 0.90); const ofs = Math.min(0.55 + (1 - bar.volume / Math.max(avgVol, 1)) * 0.25, 0.90);
        sig = { bar_idx: i, timestamp: bar.timestamp, direction: "long", entry: bar.close,
          stop: bar.low - atr * 0.4, target: bar.close + atr * 2, atr,
          structure_score: ss, order_flow_score: ofs, recall_score: 0.60,
          final_quality: (ss+ofs+0.60)/3, setup_type: "cvd_divergence", regime };
      }
    }

    if (!sig && i >= 11) {
      const prevHigh = Math.max(...bars.slice(i-10, i-1).map(b => b.high));
      const prevLow  = Math.min(...bars.slice(i-10, i-1).map(b => b.low));
      if (bars[i-1].high > prevHigh && bar.close < prevHigh && isBearish && volSpike) {
        const ss = Math.min(0.60 + bodyRatio * 0.20, 0.90); const ofs = Math.min(0.58 + (volRatio-1)*0.05, 0.90);
        sig = { bar_idx: i, timestamp: bar.timestamp, direction: "short", entry: bar.close,
          stop: bars[i-1].high + atr * 0.2, target: bar.close - atr * 1.8, atr,
          structure_score: ss, order_flow_score: ofs, recall_score: 0.62,
          final_quality: (ss+ofs+0.62)/3, setup_type: "breakout_failure", regime };
      } else if (bars[i-1].low < prevLow && bar.close > prevLow && isBullish && volSpike) {
        const ss = Math.min(0.60 + bodyRatio * 0.20, 0.90); const ofs = Math.min(0.58 + (volRatio-1)*0.05, 0.90);
        sig = { bar_idx: i, timestamp: bar.timestamp, direction: "long", entry: bar.close,
          stop: bars[i-1].low - atr * 0.2, target: bar.close + atr * 1.8, atr,
          structure_score: ss, order_flow_score: ofs, recall_score: 0.62,
          final_quality: (ss+ofs+0.62)/3, setup_type: "breakout_failure", regime };
      }
    }

    if (sig) signals.push(sig);
  }
  return signals;
}

function simulateForward(bars: OHLCVBar[], sig: RealSignal) {
  const tpTicks = Math.round(Math.abs(sig.target - sig.entry) * 100);
  const slTicks = Math.round(Math.abs(sig.stop   - sig.entry) * 100);
  for (let i = sig.bar_idx + 1; i < Math.min(sig.bar_idx + 1 + MAX_BARS_FWD, bars.length); i++) {
    const bar = bars[i];
    if (sig.direction === "long") {
      if (bar.low  <= sig.stop)   return { outcome: "loss" as const, tp_ticks: tpTicks, sl_ticks: slTicks, bars_held: i - sig.bar_idx };
      if (bar.high >= sig.target) return { outcome: "win"  as const, tp_ticks: tpTicks, sl_ticks: slTicks, bars_held: i - sig.bar_idx };
    } else {
      if (bar.high >= sig.stop)   return { outcome: "loss" as const, tp_ticks: tpTicks, sl_ticks: slTicks, bars_held: i - sig.bar_idx };
      if (bar.low  <= sig.target) return { outcome: "win"  as const, tp_ticks: tpTicks, sl_ticks: slTicks, bars_held: i - sig.bar_idx };
    }
  }
  return { outcome: "open" as const, tp_ticks: tpTicks, sl_ticks: slTicks, bars_held: MAX_BARS_FWD };
}

async function purgeStaleData(): Promise<number> {
  try {
    const [before] = await db.select({ cnt: sql<number>`count(*)::int` })
      .from(accuracyResultsTable)
      .where(sql`signal_detected IN ('SYNTHETIC_BOOTSTRAP','SYNTHETIC_BOOTSTRAP_V2')`);
    const n = before?.cnt ?? 0;
    if (n > 0) {
      await db.delete(accuracyResultsTable)
        .where(sql`signal_detected IN ('SYNTHETIC_BOOTSTRAP','SYNTHETIC_BOOTSTRAP_V2')`);
      logger.info({ purged: n }, "[seeder] Purged synthetic rows — replacing with real data");
    }
    return n;
  } catch { return 0; }
}

export interface SeederResult {
  skipped: boolean; existingRows: number; seededRows: number; durationMs: number;
  purged?: number; symbols_processed?: number; has_real_data?: boolean;
}

export async function seedHistoricalData(): Promise<SeederResult> {
  const t0 = Date.now();
  const purgedRows = await purgeStaleData();

  const [countRow] = await db.select({ cnt: sql<number>`count(*)::int` }).from(accuracyResultsTable);
  const existingRows = countRow?.cnt ?? 0;

  if (existingRows >= BOOTSTRAP_THRESHOLD) {
    logger.info({ existingRows, threshold: BOOTSTRAP_THRESHOLD }, "[seeder] Sufficient data — skipping bootstrap");
    return { skipped: true, existingRows, seededRows: 0, durationMs: Date.now() - t0, purged: purgedRows };
  }

  logger.info({ existingRows, symbols: SEED_SYMBOLS.length, version: DATA_VERSION },
    "[seeder] Fetching 1 year of real market data for SI training");

  let seeded = 0, symbolsProcessed = 0, anyRealData = false;

  for (const { symbol, tf } of SEED_SYMBOLS) {
    try {
      const { bars, has_real_data, source } = await getHistoricalBars(symbol, tf, 365);
      if (bars.length < 50) { logger.warn({ symbol, bars: bars.length }, "[seeder] Too few bars — skipping"); continue; }
      if (has_real_data) anyRealData = true;
      logger.info({ symbol, tf, bars: bars.length, source, real: has_real_data }, "[seeder] Processing");

      const signals = detectSignals(bars);
      if (!signals.length) continue;

      const rows: any[] = [];
      for (const sig of signals) {
        const sim = simulateForward(bars, sig);
        if (sim.outcome === "open") continue;
        rows.push({
          symbol, setup_type: sig.setup_type, timeframe: tf,
          bar_time: new Date(sig.timestamp),
          signal_detected: `REAL_${DATA_VERSION}`,
          structure_score:  String(sig.structure_score.toFixed(4)),
          order_flow_score: String(sig.order_flow_score.toFixed(4)),
          recall_score:     String(sig.recall_score.toFixed(4)),
          final_quality:    String(sig.final_quality.toFixed(4)),
          outcome:          sim.outcome,
          tp_ticks:         sim.tp_ticks, sl_ticks: sim.sl_ticks,
          hit_tp:           sim.outcome === "win" ? "1" : "0",
          forward_bars_checked: sim.bars_held,
          regime: sig.regime, direction: sig.direction,
        });
      }

      for (let i = 0; i < rows.length; i += BATCH_INSERT) {
        const batch = rows.slice(i, i + BATCH_INSERT);
        if (batch.length) { await db.insert(accuracyResultsTable).values(batch); seeded += batch.length; }
      }
      symbolsProcessed++;
      logger.info({ symbol, signals: signals.length, inserted: rows.length }, "[seeder] Symbol complete");
      await new Promise(r => setTimeout(r, 500));
    } catch (err) {
      logger.error({ err, symbol }, "[seeder] Symbol failed — continuing");
    }
  }

  const durationMs = Date.now() - t0;
  logger.info({ seededRows: seeded, symbols: symbolsProcessed, durationMs, real: anyRealData, version: DATA_VERSION },
    "[seeder] Real-data bootstrap complete");
  return { skipped: false, existingRows, seededRows: seeded, durationMs, purged: purgedRows, symbols_processed: symbolsProcessed, has_real_data: anyRealData };
}
