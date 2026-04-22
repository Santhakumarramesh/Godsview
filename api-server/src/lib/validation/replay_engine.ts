/**
 * Replay Engine — replays historical candles tick-by-tick through the decision pipeline.
 *
 * This is the core of strategy validation. It simulates the live environment
 * using ONLY real historical OHLCV data (never synthetic).
 *
 * NON-NEGOTIABLE RULES:
 * 1. Replay uses REAL OHLCV only — no synthetic bars
 * 2. Fills use realistic slippage/impact models
 * 3. No peeking ahead — each step sees only past data
 * 4. Results tagged with source provenance
 */
import type { CandleEvent } from "@workspace/common-types";
import { logger } from "../logger";

// ── Types ────────────────────────────────────────────────────────────────────

export interface ReplayConfig {
  symbol: string;
  timeframe: string;
  slippageBps: number;       // slippage in basis points (e.g. 5 = 0.05%)
  commissionPerTrade: number; // flat commission per trade
  initialCapital: number;
  maxPositionPct: number;     // max % of capital per trade
}

export interface ReplaySignal {
  index: number;
  direction: "long" | "short";
  entry: number;
  stopLoss: number;
  takeProfit: number;
  positionSizePct: number;
  reasoning?: string;
}

export interface ReplayTrade {
  entryIndex: number;
  exitIndex: number;
  direction: "long" | "short";
  entryPrice: number;
  exitPrice: number;
  slippage: number;
  pnl: number;
  pnlPct: number;
  holdBars: number;
  exitReason: "tp" | "sl" | "timeout" | "end_of_data";
}

export interface ReplayResult {
  symbol: string;
  timeframe: string;
  totalBars: number;
  totalTrades: number;
  winRate: number;
  profitFactor: number;
  totalPnl: number;
  totalPnlPct: number;
  maxDrawdown: number;
  maxDrawdownPct: number;
  sharpeRatio: number;
  avgWin: number;
  avgLoss: number;
  avgHoldBars: number;
  trades: ReplayTrade[];
  dataSource: "real";
  replayedAt: string;
}

// ── Replay Step ──────────────────────────────────────────────────────────────

export interface ReplayStep {
  candle: CandleEvent;
  index: number;
  done: boolean;
  visibleCandles: CandleEvent[]; // all candles up to and including this one
}

export class ReplayEngine {
  private idx = 0;
  private candles: CandleEvent[];

  constructor(candles: CandleEvent[]) {
    if (candles.length === 0) {
      throw new Error("ReplayEngine requires at least 1 candle — no synthetic data allowed");
    }
    this.candles = candles;
  }

  get totalBars(): number {
    return this.candles.length;
  }

  reset(): void {
    this.idx = 0;
  }

  next(): ReplayStep {
    const candle = this.candles[this.idx];
    const step: ReplayStep = {
      candle,
      index: this.idx,
      done: this.idx >= this.candles.length - 1,
      visibleCandles: this.candles.slice(0, this.idx + 1),
    };
    if (this.idx < this.candles.length - 1) {
      this.idx++;
    }
    return step;
  }

  peek(ahead: number): CandleEvent | null {
    const target = this.idx + ahead;
    return target < this.candles.length ? this.candles[target] : null;
  }
}

// ── Fill Simulator ───────────────────────────────────────────────────────────

function applySlippage(price: number, direction: "long" | "short", slippageBps: number): number {
  const slip = price * (slippageBps / 10000);
  return direction === "long" ? price + slip : price - slip;
}

function simulateFill(
  signal: ReplaySignal,
  candles: CandleEvent[],
  config: ReplayConfig,
  startIndex: number,
): ReplayTrade | null {
  const maxBars = 200; // timeout after 200 bars

  const entryPrice = applySlippage(signal.entry, signal.direction, config.slippageBps);

  for (let i = startIndex + 1; i < Math.min(candles.length, startIndex + maxBars + 1); i++) {
    const bar = candles[i];

    if (signal.direction === "long") {
      // Check SL first (conservative — assume worst case)
      if (bar.low <= signal.stopLoss) {
        const exitPrice = applySlippage(signal.stopLoss, "short", config.slippageBps);
        const pnl = (exitPrice - entryPrice) - config.commissionPerTrade * 2;
        return {
          entryIndex: startIndex,
          exitIndex: i,
          direction: signal.direction,
          entryPrice,
          exitPrice,
          slippage: Math.abs(entryPrice - signal.entry) + Math.abs(exitPrice - signal.stopLoss),
          pnl,
          pnlPct: entryPrice > 0 ? pnl / entryPrice : 0,
          holdBars: i - startIndex,
          exitReason: "sl",
        };
      }

      // Check TP
      if (bar.high >= signal.takeProfit) {
        const exitPrice = applySlippage(signal.takeProfit, "short", config.slippageBps);
        const pnl = (exitPrice - entryPrice) - config.commissionPerTrade * 2;
        return {
          entryIndex: startIndex,
          exitIndex: i,
          direction: signal.direction,
          entryPrice,
          exitPrice,
          slippage: Math.abs(entryPrice - signal.entry) + Math.abs(exitPrice - signal.takeProfit),
          pnl,
          pnlPct: entryPrice > 0 ? pnl / entryPrice : 0,
          holdBars: i - startIndex,
          exitReason: "tp",
        };
      }
    } else {
      // Short direction
      if (bar.high >= signal.stopLoss) {
        const exitPrice = applySlippage(signal.stopLoss, "long", config.slippageBps);
        const pnl = (entryPrice - exitPrice) - config.commissionPerTrade * 2;
        return {
          entryIndex: startIndex,
          exitIndex: i,
          direction: signal.direction,
          entryPrice,
          exitPrice,
          slippage: Math.abs(entryPrice - signal.entry) + Math.abs(exitPrice - signal.stopLoss),
          pnl,
          pnlPct: entryPrice > 0 ? pnl / entryPrice : 0,
          holdBars: i - startIndex,
          exitReason: "sl",
        };
      }

      if (bar.low <= signal.takeProfit) {
        const exitPrice = applySlippage(signal.takeProfit, "long", config.slippageBps);
        const pnl = (entryPrice - exitPrice) - config.commissionPerTrade * 2;
        return {
          entryIndex: startIndex,
          exitIndex: i,
          direction: signal.direction,
          entryPrice,
          exitPrice,
          slippage: Math.abs(entryPrice - signal.entry) + Math.abs(exitPrice - signal.takeProfit),
          pnl,
          pnlPct: entryPrice > 0 ? pnl / entryPrice : 0,
          holdBars: i - startIndex,
          exitReason: "tp",
        };
      }
    }
  }

  // Timeout — close at last bar's close
  const lastIdx = Math.min(candles.length - 1, startIndex + maxBars);
  const lastBar = candles[lastIdx];
  const exitPrice = lastBar.close;
  const pnl = signal.direction === "long"
    ? (exitPrice - entryPrice) - config.commissionPerTrade * 2
    : (entryPrice - exitPrice) - config.commissionPerTrade * 2;

  return {
    entryIndex: startIndex,
    exitIndex: lastIdx,
    direction: signal.direction,
    entryPrice,
    exitPrice,
    slippage: Math.abs(entryPrice - signal.entry),
    pnl,
    pnlPct: entryPrice > 0 ? pnl / entryPrice : 0,
    holdBars: lastIdx - startIndex,
    exitReason: lastIdx >= candles.length - 1 ? "end_of_data" : "timeout",
  };
}

// ── Metrics Calculator ───────────────────────────────────────────────────────

function computeMetrics(trades: ReplayTrade[], config: ReplayConfig): Omit<ReplayResult, "symbol" | "timeframe" | "totalBars" | "trades" | "dataSource" | "replayedAt"> {
  if (trades.length === 0) {
    return {
      totalTrades: 0, winRate: 0, profitFactor: 0, totalPnl: 0, totalPnlPct: 0,
      maxDrawdown: 0, maxDrawdownPct: 0, sharpeRatio: 0, avgWin: 0, avgLoss: 0, avgHoldBars: 0,
    };
  }

  const wins = trades.filter(t => t.pnl > 0);
  const losses = trades.filter(t => t.pnl <= 0);

  const grossProfit = wins.reduce((sum, t) => sum + t.pnl, 0);
  const grossLoss = Math.abs(losses.reduce((sum, t) => sum + t.pnl, 0));
  const totalPnl = grossProfit - grossLoss;

  // Max drawdown
  let peak = config.initialCapital;
  let maxDD = 0;
  let equity = config.initialCapital;
  for (const t of trades) {
    equity += t.pnl;
    if (equity > peak) peak = equity;
    const dd = peak - equity;
    if (dd > maxDD) maxDD = dd;
  }

  // Sharpe ratio (annualized, simplified)
  const returns = trades.map(t => t.pnlPct);
  const avgReturn = returns.reduce((a, b) => a + b, 0) / returns.length;
  const variance = returns.reduce((sum, r) => sum + (r - avgReturn) ** 2, 0) / returns.length;
  const stdDev = Math.sqrt(variance);
  const sharpeRatio = stdDev > 0 ? (avgReturn / stdDev) * Math.sqrt(252) : 0;

  return {
    totalTrades: trades.length,
    winRate: wins.length / trades.length,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0,
    totalPnl,
    totalPnlPct: config.initialCapital > 0 ? totalPnl / config.initialCapital : 0,
    maxDrawdown: maxDD,
    maxDrawdownPct: peak > 0 ? maxDD / peak : 0,
    sharpeRatio,
    avgWin: wins.length > 0 ? grossProfit / wins.length : 0,
    avgLoss: losses.length > 0 ? grossLoss / losses.length : 0,
    avgHoldBars: trades.reduce((sum, t) => sum + t.holdBars, 0) / trades.length,
  };
}

// ── Main Replay Function ─────────────────────────────────────────────────────

/**
 * Run a full replay of signals against historical candle data.
 *
 * @param candles - REAL historical candle data (never synthetic)
 * @param signalFn - function that generates signals at each bar
 * @param config - replay configuration
 */
export async function runReplay(
  candles: CandleEvent[],
  signalFn: (visibleCandles: CandleEvent[], index: number) => ReplaySignal | null,
  config: ReplayConfig,
): Promise<ReplayResult> {
  if (candles.length < 20) {
    throw new Error(`Insufficient candle data for replay: ${candles.length} bars (minimum 20 required)`);
  }

  logger.info({ symbol: config.symbol, bars: candles.length }, "Starting replay");

  const engine = new ReplayEngine(candles);
  const trades: ReplayTrade[] = [];
  let inPosition = false;
  let positionExitIndex = 0;

  // Warm-up period: need at least 20 bars before generating signals
  const warmup = 20;

  for (let i = warmup; i < candles.length - 1; i++) {
    // Skip if we're still in a position
    if (inPosition && i <= positionExitIndex) continue;
    inPosition = false;

    const visible = candles.slice(0, i + 1);
    const signal = signalFn(visible, i);

    if (signal) {
      const trade = simulateFill(signal, candles, config, i);
      if (trade) {
        trades.push(trade);
        inPosition = true;
        positionExitIndex = trade.exitIndex;
      }
    }
  }

  const metrics = computeMetrics(trades, config);

  const result: ReplayResult = {
    symbol: config.symbol,
    timeframe: config.timeframe,
    totalBars: candles.length,
    ...metrics,
    trades,
    dataSource: "real",
    replayedAt: new Date().toISOString(),
  };

  logger.info({
    symbol: config.symbol,
    trades: result.totalTrades,
    winRate: `${(result.winRate * 100).toFixed(1)}%`,
    profitFactor: result.profitFactor.toFixed(2),
    sharpe: result.sharpeRatio.toFixed(2),
  }, "Replay complete");

  return result;
}

// ── Strategy Grading ─────────────────────────────────────────────────────────

export type StrategyGrade = "A" | "B" | "C" | "D" | "F";

export function gradeStrategy(result: ReplayResult): {
  grade: StrategyGrade;
  reasons: string[];
} {
  const reasons: string[] = [];
  let score = 0;

  if (result.winRate >= 0.6) { score += 2; reasons.push("Win rate >= 60%"); }
  else if (result.winRate >= 0.5) { score += 1; reasons.push("Win rate >= 50%"); }
  else { reasons.push(`Low win rate: ${(result.winRate * 100).toFixed(1)}%`); }

  if (result.profitFactor >= 2) { score += 2; reasons.push("Profit factor >= 2.0"); }
  else if (result.profitFactor >= 1.5) { score += 1; reasons.push("Profit factor >= 1.5"); }
  else { reasons.push(`Low profit factor: ${result.profitFactor.toFixed(2)}`); }

  if (result.sharpeRatio >= 1.5) { score += 2; reasons.push("Sharpe >= 1.5"); }
  else if (result.sharpeRatio >= 1.0) { score += 1; reasons.push("Sharpe >= 1.0"); }
  else { reasons.push(`Low Sharpe: ${result.sharpeRatio.toFixed(2)}`); }

  if (result.maxDrawdownPct <= 0.1) { score += 2; reasons.push("Max DD <= 10%"); }
  else if (result.maxDrawdownPct <= 0.2) { score += 1; reasons.push("Max DD <= 20%"); }
  else { reasons.push(`High drawdown: ${(result.maxDrawdownPct * 100).toFixed(1)}%`); }

  if (result.totalTrades >= 30) { score += 1; reasons.push("Sufficient sample size (30+)"); }
  else { reasons.push(`Small sample: ${result.totalTrades} trades`); }

  let grade: StrategyGrade;
  if (score >= 8) grade = "A";
  else if (score >= 6) grade = "B";
  else if (score >= 4) grade = "C";
  else if (score >= 2) grade = "D";
  else grade = "F";

  return { grade, reasons };
}

/** Check if strategy passes minimum replay validation for promotion */
export function passesReplayValidation(result: ReplayResult): boolean {
  const { grade } = gradeStrategy(result);
  return grade === "A" || grade === "B";
}
