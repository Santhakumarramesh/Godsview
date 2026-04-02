/**
 * market_backtester.ts — Real OHLCV bars from Tiingo/AlphaVantage/Finnhub
 * → SK setup detection → Super Intelligence filter → simulated trade outcomes
 * → equity curve + full metrics
 *
 * Data source priority: Tiingo → Alpha Vantage → Finnhub → synthetic
 * Default lookback: 365 days (full year of real market data)
 */

import { getHistoricalBars, aggregateBars, type OHLCVBar, type DataTimeframe } from "./tiingo_client";
import { processSuperSignal } from "./super_intelligence";
import { logger } from "./logger";

export type MarketTimeframe = "5min" | "15min" | "30min" | "1hour" | "4hour" | "1day";

export const SUPPORTED_TIMEFRAMES: Array<{ value: MarketTimeframe; label: string; bars_per_day: number }> = [
  { value: "5min",  label: "5 Minutes",  bars_per_day: 288 },
  { value: "15min", label: "15 Minutes", bars_per_day: 96  },
  { value: "30min", label: "30 Minutes", bars_per_day: 48  },
  { value: "1hour", label: "1 Hour",     bars_per_day: 24  },
  { value: "4hour", label: "4 Hours",    bars_per_day: 6   },
  { value: "1day",  label: "Daily",      bars_per_day: 1   },
];

export interface MarketBacktestConfig {
  symbol: string;
  timeframe: MarketTimeframe;
  lookback_days: number;
  initial_equity: number;
  risk_per_trade_pct: number;
  use_si_filter: boolean;
}

export interface MarketTrade {
  bar_idx: number; timestamp: string; direction: "long" | "short";
  entry: number; stop: number; target: number; exit: number;
  outcome: "win" | "loss" | "open"; pnl_pct: number; risk_r: number;
  si_approved: boolean; si_win_prob: number; setup_type: string;
  structure_score: number; order_flow_score: number; data_source: string;
}

export interface MarketBacktestResult {
  config: MarketBacktestConfig;
  summary: {
    total_bars: number; signals_detected: number; trades_taken: number;
    si_filtered_out: number; wins: number; losses: number; win_rate: number;
    profit_factor: number; total_pnl_pct: number; max_drawdown_pct: number;
    sharpe_ratio: number; best_trade_pct: number; worst_trade_pct: number;
    avg_rrr: number; final_equity: number; cagr_pct: number;
  };
  baseline_summary: {
    win_rate: number; profit_factor: number; total_pnl_pct: number;
    max_drawdown_pct: number; sharpe_ratio: number;
  };
  improvement: { win_rate_delta: number; pf_delta: number; signals_filtered_pct: number };
  equity_curve: Array<{ idx: number; ts: string; baseline: number; si: number }>;
  trades: MarketTrade[];
  by_setup: Record<string, { count: number; wins: number; win_rate: number; avg_pnl: number }>;
  by_month: Record<string, { trades: number; wins: number; win_rate: number; pnl_pct: number }>;
  generated_at: string; has_real_data: boolean; data_source: string;
  date_range: { from: string; to: string; bars: number };
}

interface DetectedSignal {
  bar_idx: number; direction: "long" | "short"; entry: number; stop: number;
  target: number; atr: number; structure_score: number; order_flow_score: number;
  recall_score: number; setup_type: string; regime: string; final_quality: number;
}

function computeATR(bars: OHLCVBar[], period = 14): number[] {
  const atrs: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(bars[i].high - bars[i].low,
      Math.abs(bars[i].high - bars[i-1].close), Math.abs(bars[i].low - bars[i-1].close));
    if (i <= period) atrs[i] = tr;
    else atrs[i] = (atrs[i-1] * (period-1) + tr) / period;
  }
  return atrs;
}

function computeEMA(bars: OHLCVBar[], period: number): number[] {
  const emas: number[] = new Array(bars.length).fill(0);
  const k = 2 / (period + 1);
  emas[0] = bars[0].close;
  for (let i = 1; i < bars.length; i++) emas[i] = bars[i].close * k + emas[i-1] * (1-k);
  return emas;
}

function computeRSI(bars: OHLCVBar[], period = 14): number[] {
  const rsis: number[] = new Array(bars.length).fill(50);
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

function detectSignals(bars: OHLCVBar[]): DetectedSignal[] {
  if (bars.length < 50) return [];
  const signals: DetectedSignal[] = [];
  const atrs = computeATR(bars);
  const ema20 = computeEMA(bars, 20);
  const ema50 = computeEMA(bars, 50);
  const ema200 = computeEMA(bars, Math.min(200, bars.length - 1));
  const rsis = computeRSI(bars);

  for (let i = 50; i < bars.length - 3; i++) {
    const bar = bars[i]; const atr = atrs[i];
    if (atr <= 0) continue;
    const prev20 = bars.slice(i-20, i);
    const avgVol = prev20.reduce((s, b) => s + b.volume, 0) / 20;
    const volRatio = avgVol > 0 ? bar.volume / avgVol : 1;
    const volSpike = volRatio > 1.4;
    const body = Math.abs(bar.close - bar.open);
    const range = bar.high - bar.low;
    const bodyRatio = range > 0 ? body / range : 0;
    const upperWick = bar.high - Math.max(bar.open, bar.close);
    const lowerWick = Math.min(bar.open, bar.close) - bar.low;
    const lkHigh = Math.max(...prev20.map(b => b.high));
    const lkLow  = Math.min(...prev20.map(b => b.low));
    const nearLow = bar.low <= lkLow * 1.0025;
    const nearHigh = bar.high >= lkHigh * 0.9975;
    const trendUp = ema20[i] > ema50[i]; const trendDown = ema20[i] < ema50[i];
    const strongUp = ema20[i] > ema50[i] && ema50[i] > ema200[i];
    const strongDown = ema20[i] < ema50[i] && ema50[i] < ema200[i];
    const rsi = rsis[i]; const isBullish = bar.close > bar.open; const isBearish = bar.close < bar.open;
    const recentAtrs = atrs.slice(Math.max(0, i-10), i);
    const avgAtr = recentAtrs.reduce((s, a) => s + a, 0) / (recentAtrs.length || 1);
    const highVol = atr > avgAtr * 1.5 || (bar.close > 0 && atr / bar.close > 0.025);
    let regime = highVol ? "volatile" : rsi > 65 && strongUp ? "trending_bull"
      : rsi < 35 && strongDown ? "trending_bear"
      : Math.abs(ema20[i] - ema50[i]) / ema50[i] < 0.005 ? "chop" : "ranging";

    let sig: DetectedSignal | null = null;

    // Sweep Reclaim
    if (nearLow && isBullish && lowerWick > body * 0.5 && volSpike && trendUp) {
      const ss = Math.min(0.60 + bodyRatio * 0.25 + (volRatio > 2 ? 0.08 : 0), 0.95);
      const ofs = Math.min(0.55 + (lowerWick / Math.max(range, 0.001)) * 0.35 + (volRatio > 2 ? 0.07 : 0), 0.95);
      const rc = strongUp ? 0.72 : 0.58;
      sig = { bar_idx: i, direction: "long", entry: bar.close, stop: bar.low - atr * 0.3,
        target: bar.close + atr * 2.2, atr, structure_score: ss, order_flow_score: ofs,
        recall_score: rc, setup_type: "sweep_reclaim", regime, final_quality: (ss+ofs+rc)/3 };
    } else if (nearHigh && isBearish && upperWick > body * 0.5 && volSpike && trendDown) {
      const ss = Math.min(0.60 + bodyRatio * 0.25 + (volRatio > 2 ? 0.08 : 0), 0.95);
      const ofs = Math.min(0.55 + (upperWick / Math.max(range, 0.001)) * 0.35 + (volRatio > 2 ? 0.07 : 0), 0.95);
      const rc = strongDown ? 0.72 : 0.58;
      sig = { bar_idx: i, direction: "short", entry: bar.close, stop: bar.high + atr * 0.3,
        target: bar.close - atr * 2.2, atr, structure_score: ss, order_flow_score: ofs,
        recall_score: rc, setup_type: "sweep_reclaim", regime, final_quality: (ss+ofs+rc)/3 };
    }

    // Continuation Pullback
    if (!sig && strongUp && rsi > 50 && rsi < 65 && Math.abs(bar.low - ema20[i]) < atr * 0.4 && isBullish && volSpike) {
      const ss = Math.min(0.65 + bodyRatio * 0.20, 0.95);
      const ofs = Math.min(0.60 + bodyRatio * 0.25, 0.95);
      sig = { bar_idx: i, direction: "long", entry: bar.close,
        stop: Math.min(bar.low, ema50[i]) - atr * 0.2, target: bar.close + atr * 2.5,
        atr, structure_score: ss, order_flow_score: ofs, recall_score: 0.70,
        setup_type: "continuation_pullback", regime, final_quality: (ss+ofs+0.70)/3 };
    } else if (!sig && strongDown && rsi < 50 && rsi > 35 && Math.abs(bar.high - ema20[i]) < atr * 0.4 && isBearish && volSpike) {
      const ss = Math.min(0.65 + bodyRatio * 0.20, 0.95);
      const ofs = Math.min(0.60 + bodyRatio * 0.25, 0.95);
      sig = { bar_idx: i, direction: "short", entry: bar.close,
        stop: Math.max(bar.high, ema50[i]) + atr * 0.2, target: bar.close - atr * 2.5,
        atr, structure_score: ss, order_flow_score: ofs, recall_score: 0.70,
        setup_type: "continuation_pullback", regime, final_quality: (ss+ofs+0.70)/3 };
    }

    // CVD Divergence
    if (!sig) {
      const volDecline = bar.volume < avgVol * 0.7;
      if (nearHigh && isBearish && volDecline && trendUp && rsi > 70) {
        const ss = Math.min(0.58 + Math.random() * 0.18, 0.90);
        const ofs = Math.min(0.55 + (1 - bar.volume / Math.max(avgVol, 1)) * 0.25, 0.90);
        sig = { bar_idx: i, direction: "short", entry: bar.close, stop: bar.high + atr * 0.4,
          target: bar.close - atr * 2, atr, structure_score: ss, order_flow_score: ofs,
          recall_score: 0.60, setup_type: "cvd_divergence", regime, final_quality: (ss+ofs+0.60)/3 };
      } else if (nearLow && isBullish && volDecline && trendDown && rsi < 30) {
        const ss = Math.min(0.58 + Math.random() * 0.18, 0.90);
        const ofs = Math.min(0.55 + (1 - bar.volume / Math.max(avgVol, 1)) * 0.25, 0.90);
        sig = { bar_idx: i, direction: "long", entry: bar.close, stop: bar.low - atr * 0.4,
          target: bar.close + atr * 2, atr, structure_score: ss, order_flow_score: ofs,
          recall_score: 0.60, setup_type: "cvd_divergence", regime, final_quality: (ss+ofs+0.60)/3 };
      }
    }

    // Breakout Failure
    if (!sig && i >= 11) {
      const prevHigh = Math.max(...bars.slice(i-10, i-1).map(b => b.high));
      const prevLow  = Math.min(...bars.slice(i-10, i-1).map(b => b.low));
      if (bars[i-1].high > prevHigh && bar.close < prevHigh && isBearish && volSpike) {
        const ss = Math.min(0.60 + bodyRatio * 0.20, 0.90);
        const ofs = Math.min(0.58 + (volRatio - 1) * 0.05, 0.90);
        sig = { bar_idx: i, direction: "short", entry: bar.close, stop: bars[i-1].high + atr * 0.2,
          target: bar.close - atr * 1.8, atr, structure_score: ss, order_flow_score: ofs,
          recall_score: 0.62, setup_type: "breakout_failure", regime, final_quality: (ss+ofs+0.62)/3 };
      } else if (bars[i-1].low < prevLow && bar.close > prevLow && isBullish && volSpike) {
        const ss = Math.min(0.60 + bodyRatio * 0.20, 0.90);
        const ofs = Math.min(0.58 + (volRatio - 1) * 0.05, 0.90);
        sig = { bar_idx: i, direction: "long", entry: bar.close, stop: bars[i-1].low - atr * 0.2,
          target: bar.close + atr * 1.8, atr, structure_score: ss, order_flow_score: ofs,
          recall_score: 0.62, setup_type: "breakout_failure", regime, final_quality: (ss+ofs+0.62)/3 };
      }
    }

    if (sig) signals.push(sig);
  }
  return signals;
}

function simulateTrade(bars: OHLCVBar[], sig: DetectedSignal, maxFwd = 30) {
  for (let i = sig.bar_idx + 1; i < Math.min(sig.bar_idx + 1 + maxFwd, bars.length); i++) {
    const bar = bars[i];
    if (sig.direction === "long") {
      if (bar.low  <= sig.stop)   return { outcome: "loss" as const, exit: sig.stop,   pnl_pct: (sig.stop   - sig.entry) / sig.entry };
      if (bar.high >= sig.target) return { outcome: "win"  as const, exit: sig.target, pnl_pct: (sig.target - sig.entry) / sig.entry };
    } else {
      if (bar.high >= sig.stop)   return { outcome: "loss" as const, exit: sig.stop,   pnl_pct: (sig.entry - sig.stop  ) / sig.entry };
      if (bar.low  <= sig.target) return { outcome: "win"  as const, exit: sig.target, pnl_pct: (sig.entry - sig.target) / sig.entry };
    }
  }
  const lastBar = bars[Math.min(sig.bar_idx + maxFwd, bars.length - 1)];
  const exit = lastBar?.close ?? sig.entry;
  return { outcome: "open" as const, exit, pnl_pct: sig.direction === "long" ? (exit - sig.entry) / sig.entry : (sig.entry - exit) / sig.entry };
}

interface MetricsResult { win_rate: number; profit_factor: number; max_drawdown_pct: number; sharpe_ratio: number; best: number; worst: number; }

function computeMetrics(pnls: number[]): MetricsResult {
  if (!pnls.length) return { win_rate: 0, profit_factor: 0, max_drawdown_pct: 0, sharpe_ratio: 0, best: 0, worst: 0 };
  const wins = pnls.filter(p => p > 0); const losses = pnls.filter(p => p <= 0);
  const grossWin = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const win_rate = wins.length / pnls.length;
  const profit_factor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;
  let peak = 1, equity = 1, maxDD = 0;
  for (const p of pnls) { equity *= 1 + p; if (equity > peak) peak = equity; const dd = (peak - equity) / peak; if (dd > maxDD) maxDD = dd; }
  const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length;
  const std = Math.sqrt(variance);
  return { win_rate, profit_factor, max_drawdown_pct: maxDD * 100, sharpe_ratio: std > 0 ? (mean / std) * Math.sqrt(252) : 0, best: Math.max(...pnls) * 100, worst: Math.min(...pnls) * 100 };
}

export async function runMarketBacktest(config: MarketBacktestConfig): Promise<MarketBacktestResult> {
  const { symbol, timeframe, lookback_days, initial_equity, risk_per_trade_pct, use_si_filter } = config;

  const { bars, source: dataSource, has_real_data } = await getHistoricalBars(
    symbol, timeframe as DataTimeframe, Math.max(lookback_days, 365)
  );
  logger.info({ symbol, timeframe, bars: bars.length, source: dataSource, real: has_real_data }, "[market-backtest] Data loaded");
  if (bars.length < 50) throw new Error(`Insufficient bars for ${symbol} ${timeframe}: ${bars.length}`);

  const signals = detectSignals(bars);
  logger.info({ symbol, signals: signals.length }, "[market-backtest] Signals detected");

  const baselineTrades: MarketTrade[] = [];
  const siTrades: MarketTrade[] = [];
  const bySetup: Record<string, { count: number; wins: number; win_rate: number; avg_pnl: number; pnl_sum: number }> = {};
  const byMonth: Record<string, { trades: number; wins: number; win_rate: number; pnl_pct: number }> = {};

  let sigIdx = 0;
  for (const sig of signals) {
    const sim = simulateTrade(bars, sig);
    const risk_r = sig.stop !== sig.entry ? Math.abs(sig.target - sig.entry) / Math.abs(sig.stop - sig.entry) : 2;
    const baseTrade: MarketTrade = {
      bar_idx: sig.bar_idx, timestamp: bars[sig.bar_idx]?.timestamp ?? new Date().toISOString(),
      direction: sig.direction, entry: sig.entry, stop: sig.stop, target: sig.target,
      exit: sim.exit, outcome: sim.outcome, pnl_pct: sim.pnl_pct * 100, risk_r,
      si_approved: false, si_win_prob: 0, setup_type: sig.setup_type,
      structure_score: sig.structure_score, order_flow_score: sig.order_flow_score, data_source: dataSource,
    };
    baselineTrades.push(baseTrade);

    let siApproved = true; let siWinProb = 0.5;
    if (use_si_filter) {
      try {
        const siResult = await processSuperSignal(sigIdx++, symbol, {
          structure_score: sig.structure_score, order_flow_score: sig.order_flow_score,
          recall_score: sig.recall_score, setup_type: sig.setup_type, regime: sig.regime,
          direction: sig.direction, entry_price: sig.entry, stop_loss: sig.stop,
          take_profit: sig.target, atr: sig.atr, equity: initial_equity, final_quality: sig.final_quality,
        });
        siApproved = siResult.approved ?? true; siWinProb = siResult.win_probability ?? 0.5;
      } catch { /* SI not ready */ }
    }
    if (siApproved) siTrades.push({ ...baseTrade, si_approved: true, si_win_prob: siWinProb });

    const st = sig.setup_type;
    if (!bySetup[st]) bySetup[st] = { count: 0, wins: 0, win_rate: 0, avg_pnl: 0, pnl_sum: 0 };
    bySetup[st].count++; if (sim.outcome === "win") bySetup[st].wins++; bySetup[st].pnl_sum += sim.pnl_pct * 100;
    const month = baseTrade.timestamp.slice(0, 7);
    if (!byMonth[month]) byMonth[month] = { trades: 0, wins: 0, win_rate: 0, pnl_pct: 0 };
    byMonth[month].trades++; if (sim.outcome === "win") byMonth[month].wins++; byMonth[month].pnl_pct += sim.pnl_pct * 100;
  }

  for (const st of Object.keys(bySetup)) {
    bySetup[st].win_rate = bySetup[st].count > 0 ? bySetup[st].wins / bySetup[st].count : 0;
    bySetup[st].avg_pnl  = bySetup[st].count > 0 ? bySetup[st].pnl_sum / bySetup[st].count : 0;
  }
  for (const mo of Object.keys(byMonth)) byMonth[mo].win_rate = byMonth[mo].trades > 0 ? byMonth[mo].wins / byMonth[mo].trades : 0;

  let baselineEq = initial_equity, siEq = initial_equity;
  const allIdxs = [...new Set([...baselineTrades.map(t => t.bar_idx), ...siTrades.map(t => t.bar_idx)])].sort((a, b) => a - b);
  const equityCurve = [{ idx: 0, ts: bars[0]?.timestamp ?? "", baseline: initial_equity, si: initial_equity }];
  for (const idx of allIdxs) {
    const bt = baselineTrades.find(t => t.bar_idx === idx);
    const st = siTrades.find(t => t.bar_idx === idx);
    if (bt && bt.outcome !== "open") baselineEq *= 1 + bt.pnl_pct / 100 * risk_per_trade_pct * 100;
    if (st && st.outcome !== "open") siEq       *= 1 + st.pnl_pct / 100 * risk_per_trade_pct * 100;
    equityCurve.push({ idx, ts: bars[idx]?.timestamp ?? "", baseline: Math.round(baselineEq * 100) / 100, si: Math.round(siEq * 100) / 100 });
  }

  const closedBase = baselineTrades.filter(t => t.outcome !== "open");
  const closedSI   = siTrades.filter(t => t.outcome !== "open");
  const baselinePnls = closedBase.map(t => t.pnl_pct / 100 * risk_per_trade_pct * 100);
  const siPnls       = closedSI.map(t => t.pnl_pct / 100 * risk_per_trade_pct * 100);
  const baselineM = computeMetrics(baselinePnls); const siM = computeMetrics(siPnls);
  const tradesSrc = use_si_filter ? siTrades : baselineTrades;
  const closedSrc = tradesSrc.filter(t => t.outcome !== "open");
  const finalEquity = use_si_filter ? siEq : baselineEq;
  const cagr = lookback_days > 0 ? (Math.pow(finalEquity / initial_equity, 365 / lookback_days) - 1) * 100 : 0;
  const avgRRR = tradesSrc.length > 0 ? tradesSrc.reduce((s, t) => s + t.risk_r, 0) / tradesSrc.length : 0;
  const mSrc = use_si_filter ? siM : baselineM;

  return {
    config,
    summary: {
      total_bars: bars.length, signals_detected: signals.length, trades_taken: tradesSrc.length,
      si_filtered_out: baselineTrades.length - siTrades.length,
      wins: tradesSrc.filter(t => t.outcome === "win").length,
      losses: tradesSrc.filter(t => t.outcome === "loss").length,
      win_rate: mSrc.win_rate, profit_factor: mSrc.profit_factor,
      total_pnl_pct: closedSrc.reduce((s, t) => s + t.pnl_pct, 0),
      max_drawdown_pct: mSrc.max_drawdown_pct, sharpe_ratio: mSrc.sharpe_ratio,
      best_trade_pct: mSrc.best, worst_trade_pct: mSrc.worst,
      avg_rrr: avgRRR, final_equity: finalEquity, cagr_pct: cagr,
    },
    baseline_summary: {
      win_rate: baselineM.win_rate, profit_factor: baselineM.profit_factor,
      total_pnl_pct: closedBase.reduce((s, t) => s + t.pnl_pct, 0),
      max_drawdown_pct: baselineM.max_drawdown_pct, sharpe_ratio: baselineM.sharpe_ratio,
    },
    improvement: {
      win_rate_delta: (siM.win_rate - baselineM.win_rate) * 100,
      pf_delta: siM.profit_factor - baselineM.profit_factor,
      signals_filtered_pct: baselineTrades.length > 0 ? ((baselineTrades.length - siTrades.length) / baselineTrades.length) * 100 : 0,
    },
    equity_curve: equityCurve, trades: tradesSrc.slice(-500),
    by_setup: bySetup as any, by_month: byMonth,
    generated_at: new Date().toISOString(), has_real_data, data_source: dataSource,
    date_range: { from: bars[0]?.timestamp ?? "", to: bars[bars.length-1]?.timestamp ?? "", bars: bars.length },
  };
}
