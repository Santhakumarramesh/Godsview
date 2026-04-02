/**
 * Market Backtester — Live OHLCV bars from Alpaca → SK system signal detection
 * → Super Intelligence filter → simulated trade outcomes → equity curve.
 *
 * Supports timeframes: 5Min, 15Min, 30Min, 1Hour, 2Hour, 4Hour, 1Day
 * Uses real bar data; falls back to synthetic data when Alpaca is unavailable.
 */

import { getBars, getBarsHistorical, type AlpacaBar } from "./alpaca";
import { processSuperSignal } from "./super_intelligence";
import { logger } from "./logger";

// ── Types ──────────────────────────────────────────────────────────────────

export type MarketTimeframe =
  | "5Min" | "15Min" | "30Min"
  | "1Hour" | "2Hour" | "4Hour"
  | "1Day";

export const SUPPORTED_TIMEFRAMES: Array<{
  value: MarketTimeframe;
  label: string;
  bars_per_day: number;
}> = [
  { value: "5Min",   label: "5 Minutes",  bars_per_day: 288 },
  { value: "15Min",  label: "15 Minutes", bars_per_day: 96  },
  { value: "30Min",  label: "30 Minutes", bars_per_day: 48  },
  { value: "1Hour",  label: "1 Hour",     bars_per_day: 24  },
  { value: "2Hour",  label: "2 Hours",    bars_per_day: 12  },
  { value: "4Hour",  label: "4 Hours",    bars_per_day: 6   },
  { value: "1Day",   label: "Daily",      bars_per_day: 1   },
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
  bar_idx: number;
  timestamp: string;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  exit: number;
  outcome: "win" | "loss" | "open";
  pnl_pct: number;
  risk_r: number;
  si_approved: boolean;
  si_win_prob: number;
  setup_type: string;
}

export interface MarketBacktestResult {
  config: MarketBacktestConfig;
  summary: {
    total_bars: number;
    signals_detected: number;
    trades_taken: number;
    si_filtered_out: number;
    wins: number;
    losses: number;
    win_rate: number;
    profit_factor: number;
    total_pnl_pct: number;
    max_drawdown_pct: number;
    sharpe_ratio: number;
    best_trade_pct: number;
    worst_trade_pct: number;
    avg_rrr: number;
  };
  equity_curve: Array<{ idx: number; ts: string; baseline: number; si: number }>;
  trades: MarketTrade[];
  by_setup: Record<string, { count: number; wins: number; win_rate: number }>;
  generated_at: string;
  has_real_data: boolean;
}

// ── Signal Detection ───────────────────────────────────────────────────────

interface DetectedSignal {
  bar_idx: number;
  direction: "long" | "short";
  entry: number;
  stop: number;
  target: number;
  atr: number;
  structure_score: number;
  order_flow_score: number;
  setup_type: string;
}

function computeATR(bars: AlpacaBar[], period = 14): number[] {
  const atrs: number[] = new Array(bars.length).fill(0);
  for (let i = 1; i < bars.length; i++) {
    const tr = Math.max(
      bars[i].High - bars[i].Low,
      Math.abs(bars[i].High - bars[i - 1].Close),
      Math.abs(bars[i].Low - bars[i - 1].Close)
    );
    if (i < period) {
      atrs[i] = tr;
    } else if (i === period) {
      atrs[i] = bars.slice(1, period + 1).reduce((s, b, j) => {
        const t = Math.max(b.High - b.Low, Math.abs(b.High - bars[j].Close), Math.abs(b.Low - bars[j].Close));
        return s + t;
      }, 0) / period;
    } else {
      atrs[i] = (atrs[i - 1] * (period - 1) + tr) / period;
    }
  }
  return atrs;
}

function detectSignals(bars: AlpacaBar[]): DetectedSignal[] {
  if (bars.length < 20) return [];
  const signals: DetectedSignal[] = [];
  const atrs = computeATR(bars);

  for (let i = 20; i < bars.length - 1; i++) {
    const bar = bars[i];
    const atr = atrs[i];
    if (atr <= 0) continue;

    const prev5 = bars.slice(i - 5, i);
    const prev20 = bars.slice(i - 20, i);

    // ── EMA20 trend bias ─────────────────────────────────────────────────
    const ema20 = prev20.reduce((s, b) => s + b.Close, 0) / 20;
    const ema5  = prev5.reduce((s, b) => s + b.Close, 0) / 5;
    const trendBullish = ema5 > ema20;
    const trendBearish = ema5 < ema20;

    // ── Body size + wick ratio (order flow proxy) ────────────────────────
    const body = Math.abs(bar.Close - bar.Open);
    const range = bar.High - bar.Low;
    const bodyRatio = range > 0 ? body / range : 0;
    const upperWick = bar.High - Math.max(bar.Open, bar.Close);
    const lowerWick = Math.min(bar.Open, bar.Close) - bar.Low;
    const orderFlowBullish = lowerWick < upperWick * 0.5 && bodyRatio > 0.5;
    const orderFlowBearish = upperWick < lowerWick * 0.5 && bodyRatio > 0.5;

    // ── Support/Resistance sweep (SK system: absorption) ─────────────────
    const lookbackHigh = Math.max(...prev20.map(b => b.High));
    const lookbackLow  = Math.min(...prev20.map(b => b.Low));
    const nearLow  = bar.Low <= lookbackLow * 1.002;
    const nearHigh = bar.High >= lookbackHigh * 0.998;

    // ── Volume spike ─────────────────────────────────────────────────────
    const avgVol = prev20.reduce((s, b) => s + (b.Volume ?? 0), 0) / 20;
    const volSpike = (bar.Volume ?? 0) > avgVol * 1.5;

    let signal: DetectedSignal | null = null;

    // Long: sweep low + bullish order flow + trend up + vol spike
    if (nearLow && orderFlowBullish && trendBullish && volSpike) {
      const structure_score = 0.55 + Math.random() * 0.35;
      const order_flow_score = orderFlowBullish ? 0.6 + bodyRatio * 0.3 : 0.4;
      signal = {
        bar_idx: i,
        direction: "long",
        entry: bar.Close,
        stop: bar.Low - atr * 0.5,
        target: bar.Close + atr * 2,
        atr,
        structure_score,
        order_flow_score,
        setup_type: "absorption_reversal",
      };
    }
    // Short: sweep high + bearish order flow + trend down + vol spike
    else if (nearHigh && orderFlowBearish && trendBearish && volSpike) {
      const structure_score = 0.55 + Math.random() * 0.35;
      const order_flow_score = orderFlowBearish ? 0.6 + bodyRatio * 0.3 : 0.4;
      signal = {
        bar_idx: i,
        direction: "short",
        entry: bar.Close,
        stop: bar.High + atr * 0.5,
        target: bar.Close - atr * 2,
        atr,
        structure_score,
        order_flow_score,
        setup_type: "liquidity_sweep",
      };
    }

    if (signal) signals.push(signal);
  }

  return signals;
}

// ── Trade Simulation ───────────────────────────────────────────────────────

function simulateTrade(
  bars: AlpacaBar[],
  sig: DetectedSignal,
  maxBarsForward = 20
): { outcome: "win" | "loss" | "open"; exit: number; pnl_pct: number } {
  const startIdx = sig.bar_idx + 1;
  const endIdx = Math.min(startIdx + maxBarsForward, bars.length);

  for (let i = startIdx; i < endIdx; i++) {
    const bar = bars[i];
    if (sig.direction === "long") {
      if (bar.Low <= sig.stop) {
        const exit = sig.stop;
        return { outcome: "loss", exit, pnl_pct: (exit - sig.entry) / sig.entry };
      }
      if (bar.High >= sig.target) {
        const exit = sig.target;
        return { outcome: "win", exit, pnl_pct: (exit - sig.entry) / sig.entry };
      }
    } else {
      if (bar.High >= sig.stop) {
        const exit = sig.stop;
        return { outcome: "loss", exit, pnl_pct: (sig.entry - exit) / sig.entry };
      }
      if (bar.Low <= sig.target) {
        const exit = sig.target;
        return { outcome: "win", exit, pnl_pct: (sig.entry - exit) / sig.entry };
      }
    }
  }
  // Open / time-out: exit at last bar
  const lastBar = bars[Math.min(endIdx, bars.length - 1)];
  const exit = lastBar?.Close ?? sig.entry;
  const pnl_pct = sig.direction === "long"
    ? (exit - sig.entry) / sig.entry
    : (sig.entry - exit) / sig.entry;
  return { outcome: "open", exit, pnl_pct };
}

// ── Metrics ────────────────────────────────────────────────────────────────

function computeMetrics(pnls: number[]): {
  win_rate: number; profit_factor: number; max_drawdown_pct: number;
  sharpe_ratio: number; best: number; worst: number;
} {
  if (pnls.length === 0) {
    return { win_rate: 0, profit_factor: 0, max_drawdown_pct: 0, sharpe_ratio: 0, best: 0, worst: 0 };
  }
  const wins  = pnls.filter(p => p > 0);
  const losses = pnls.filter(p => p <= 0);
  const grossWin  = wins.reduce((s, p) => s + p, 0);
  const grossLoss = Math.abs(losses.reduce((s, p) => s + p, 0));
  const win_rate = pnls.length > 0 ? wins.length / pnls.length : 0;
  const profit_factor = grossLoss > 0 ? grossWin / grossLoss : grossWin > 0 ? 99 : 0;

  // Drawdown
  let peak = 1; let equity = 1; let maxDD = 0;
  for (const p of pnls) {
    equity *= (1 + p);
    if (equity > peak) peak = equity;
    const dd = (peak - equity) / peak;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe (annualised; assume 252 trading bars per year as approximation)
  const mean = pnls.reduce((s, p) => s + p, 0) / pnls.length;
  const variance = pnls.reduce((s, p) => s + (p - mean) ** 2, 0) / pnls.length;
  const std = Math.sqrt(variance);
  const sharpe_ratio = std > 0 ? (mean / std) * Math.sqrt(252) : 0;

  return {
    win_rate,
    profit_factor,
    max_drawdown_pct: maxDD * 100,
    sharpe_ratio,
    best: Math.max(...pnls) * 100,
    worst: Math.min(...pnls) * 100,
  };
}

// ── Main ───────────────────────────────────────────────────────────────────

export async function runMarketBacktest(config: MarketBacktestConfig): Promise<MarketBacktestResult> {
  const { symbol, timeframe, lookback_days, initial_equity, risk_per_trade_pct, use_si_filter } = config;

  // Map our timeframe labels to AlpacaTimeframe (extend as needed)
  const TF_TO_ALPACA: Record<MarketTimeframe, "5Min" | "15Min" | "1Hour" | "1Day"> = {
    "5Min":  "5Min",
    "15Min": "15Min",
    "30Min": "15Min",   // aggregate 2× 15m bars ← approximation
    "1Hour": "1Hour",
    "2Hour": "1Hour",   // aggregate 2× 1h bars
    "4Hour": "1Hour",   // aggregate 4× 1h bars
    "1Day":  "1Day",
  };
  const alpacaTF = TF_TO_ALPACA[timeframe];

  // Calculate bar count needed
  const tfMeta = SUPPORTED_TIMEFRAMES.find(t => t.value === timeframe)!;
  const barsNeeded = Math.min(tfMeta.bars_per_day * lookback_days, 10_000);

  let bars: AlpacaBar[] = [];
  let hasRealData = false;

  try {
    const start = new Date();
    start.setDate(start.getDate() - lookback_days);
    bars = await getBarsHistorical(symbol, alpacaTF, start.toISOString(), new Date().toISOString(), barsNeeded);
    hasRealData = bars.length > 10;
    logger.info({ symbol, timeframe, bar_count: bars.length }, "[market-backtest] Fetched bars");
  } catch (err) {
    logger.warn({ err, symbol }, "[market-backtest] Alpaca bars unavailable — using synthetic data");
  }

  // Fallback: generate synthetic bars if Alpaca unavailable
  if (bars.length < 20) {
    bars = generateSyntheticBars(barsNeeded, symbol);
    hasRealData = false;
  }

  // Aggregate if needed (e.g. 30Min from 15Min bars)
  if ((timeframe === "30Min" || timeframe === "2Hour" || timeframe === "4Hour") && bars.length > 0) {
    const groupSize = timeframe === "30Min" ? 2 : timeframe === "2Hour" ? 2 : 4;
    bars = aggregateBars(bars, groupSize);
  }

  // Detect signals
  const signals = detectSignals(bars);
  logger.info({ symbol, timeframe, signals: signals.length }, "[market-backtest] Signals detected");

  // Process each signal
  const baselineTrades: MarketTrade[] = [];
  const siTrades: MarketTrade[] = [];
  const bySetup: Record<string, { count: number; wins: number; win_rate: number }> = {};

  for (const sig of signals) {
    const sim = simulateTrade(bars, sig);

    const baselineTrade: MarketTrade = {
      bar_idx: sig.bar_idx,
      timestamp: bars[sig.bar_idx]?.Timestamp ?? new Date().toISOString(),
      direction: sig.direction,
      entry: sig.entry,
      stop: sig.stop,
      target: sig.target,
      exit: sim.exit,
      outcome: sim.outcome,
      pnl_pct: sim.pnl_pct * 100,
      risk_r: sig.stop !== sig.entry ? Math.abs(sig.target - sig.entry) / Math.abs(sig.stop - sig.entry) : 2,
      si_approved: false,
      si_win_prob: 0,
      setup_type: sig.setup_type,
    };
    baselineTrades.push(baselineTrade);

    // SI evaluation
    let siApproved = true;
    let siWinProb = 0.5;
    if (use_si_filter) {
      try {
        const siResult = await processSuperSignal(sig.bar_idx, symbol, {
          structure_score: sig.structure_score,
          order_flow_score: sig.order_flow_score,
          recall_score: 0.55,
          setup_type: sig.setup_type,
          regime: "trending",
          direction: sig.direction,
          entry_price: sig.entry,
          stop_loss: sig.stop,
          take_profit: sig.target,
          atr: sig.atr,
          equity: initial_equity,
        });
        siApproved = siResult.approved ?? true;
        siWinProb = siResult.win_probability ?? 0.5;
      } catch { /* SI unavailable, default to approve */ }
    }

    if (siApproved) {
      siTrades.push({ ...baselineTrade, si_approved: true, si_win_prob: siWinProb });
    }

    // By-setup stats
    if (!bySetup[sig.setup_type]) bySetup[sig.setup_type] = { count: 0, wins: 0, win_rate: 0 };
    bySetup[sig.setup_type].count++;
    if (sim.outcome === "win") bySetup[sig.setup_type].wins++;
  }

  // Compute by-setup win rates
  for (const k of Object.keys(bySetup)) {
    bySetup[k].win_rate = bySetup[k].count > 0 ? bySetup[k].wins / bySetup[k].count : 0;
  }

  // Build equity curves
  const equityCurve: Array<{ idx: number; ts: string; baseline: number; si: number }> = [];
  let baselineEq = initial_equity;
  let siEq = initial_equity;
  const allIdxs = new Set([
    ...baselineTrades.map(t => t.bar_idx),
    ...siTrades.map(t => t.bar_idx),
  ]);
  const sortedIdxs = Array.from(allIdxs).sort((a, b) => a - b);

  for (const idx of sortedIdxs) {
    const bt = baselineTrades.find(t => t.bar_idx === idx);
    const st = siTrades.find(t => t.bar_idx === idx);
    if (bt) baselineEq *= (1 + bt.pnl_pct / 100);
    if (st) siEq *= (1 + st.pnl_pct / 100);
    equityCurve.push({
      idx,
      ts: bars[idx]?.Timestamp ?? "",
      baseline: Math.round(baselineEq * 100) / 100,
      si: Math.round(siEq * 100) / 100,
    });
  }

  // Add start + end points
  if (equityCurve.length === 0 || equityCurve[0].idx !== 0) {
    equityCurve.unshift({ idx: 0, ts: bars[0]?.Timestamp ?? "", baseline: initial_equity, si: initial_equity });
  }

  const baselinePnls = baselineTrades.filter(t => t.outcome !== "open").map(t => t.pnl_pct / 100);
  const siPnls = siTrades.filter(t => t.outcome !== "open").map(t => t.pnl_pct / 100);
  const baselineMetrics = computeMetrics(baselinePnls);
  const siMetrics = computeMetrics(siPnls);

  // Use SI metrics for summary (more relevant)
  const metricSrc = use_si_filter ? siMetrics : baselineMetrics;
  const tradesSrc  = use_si_filter ? siTrades  : baselineTrades;
  const totalPnlPct = tradesSrc
    .filter(t => t.outcome !== "open")
    .reduce((s, t) => s + t.pnl_pct, 0);
  const avgRRR = tradesSrc.length > 0
    ? tradesSrc.reduce((s, t) => s + t.risk_r, 0) / tradesSrc.length
    : 0;

  return {
    config,
    summary: {
      total_bars: bars.length,
      signals_detected: signals.length,
      trades_taken: tradesSrc.length,
      si_filtered_out: baselineTrades.length - siTrades.length,
      wins: tradesSrc.filter(t => t.outcome === "win").length,
      losses: tradesSrc.filter(t => t.outcome === "loss").length,
      win_rate: metricSrc.win_rate,
      profit_factor: metricSrc.profit_factor,
      total_pnl_pct: totalPnlPct,
      max_drawdown_pct: metricSrc.max_drawdown_pct,
      sharpe_ratio: metricSrc.sharpe_ratio,
      best_trade_pct: metricSrc.best,
      worst_trade_pct: metricSrc.worst,
      avg_rrr: avgRRR,
    },
    equity_curve: equityCurve,
    trades: tradesSrc.slice(-200),       // last 200 trades for the table
    by_setup: bySetup,
    generated_at: new Date().toISOString(),
    has_real_data: hasRealData,
  };
}

// ── Bar Aggregation ────────────────────────────────────────────────────────

function aggregateBars(bars: AlpacaBar[], groupSize: number): AlpacaBar[] {
  const result: AlpacaBar[] = [];
  for (let i = 0; i < bars.length; i += groupSize) {
    const chunk = bars.slice(i, i + groupSize);
    if (chunk.length === 0) continue;
    const agg = {
      Timestamp: chunk[0].Timestamp,
      Open:   chunk[0].Open,
      High:   Math.max(...chunk.map(b => b.High)),
      Low:    Math.min(...chunk.map(b => b.Low)),
      Close:  chunk[chunk.length - 1].Close,
      Volume: chunk.reduce((s, b) => s + (b.Volume ?? 0), 0),
    };
    result.push({ t: agg.Timestamp, o: agg.Open, h: agg.High, l: agg.Low, c: agg.Close, v: agg.Volume, ...agg });
  }
  return result;
}

// ── Synthetic Bar Generator (fallback when Alpaca unavailable) ─────────────

function generateSyntheticBars(count: number, symbol: string): AlpacaBar[] {
  const basePrice = symbol.startsWith("BTC") ? 65_000
    : symbol.startsWith("ETH") ? 3_200
    : symbol.startsWith("EUR") ? 1.08
    : symbol.startsWith("GBP") ? 1.26
    : 150; // generic stock
  const volatility = basePrice * 0.008;
  const bars: AlpacaBar[] = [];
  let price = basePrice;
  const now = Date.now();
  for (let i = 0; i < count; i++) {
    const change = (Math.random() - 0.495) * volatility;
    const open = price;
    const close = Math.max(price + change, price * 0.95);
    const high = Math.max(open, close) + Math.random() * volatility * 0.5;
    const low  = Math.min(open, close) - Math.random() * volatility * 0.5;
    const ts   = new Date(now - (count - i) * 60 * 60 * 1000).toISOString();
    const vol = Math.floor(Math.random() * 5000 + 500);
    bars.push({ t: ts, o: open, h: high, l: low, c: close, v: vol, Timestamp: ts, Open: open, High: high, Low: low, Close: close, Volume: vol });
    price = close;
  }
  return bars;
}
