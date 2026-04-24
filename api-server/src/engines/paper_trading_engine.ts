/**
 * Paper Trading Engine — Hardened end-to-end paper trading loop (Phase 74)
 *
 * Orchestrates:
 * 1. Signal reception & validation
 * 2. Risk checks (daily limits, position limits, signal quality)
 * 3. Circuit breaker & cooldown enforcement
 * 4. Order execution in paper mode
 * 5. Trade persistence & P&L tracking
 * 6. State management & reporting
 */

import { logger } from "../lib/logger";
import { persistWrite, persistRead, persistAppend } from "../lib/persistent_store";
import {
  isTradingAllowed,
  getCircuitBreakerSnapshot,
  recordTradeResult,
} from "../lib/circuit_breaker";
import { executeOrder, type ExecutionRequest } from "../lib/order_executor";
import type { SuperSignal } from "../lib/super_intelligence";

// ── Types ──────────────────────────────────────────────────────────────────────

export interface PaperTradingConfig {
  maxDailyTrades: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  paperEquity: number;
  signalThreshold: number;
  cooldownMs: number;
  sessionHoursUTC: [number, number];
}

export interface PaperTradingState {
  status: "idle" | "running" | "paused" | "error";
  equity: number;
  cash: number;
  openPositions: number;
  todayTrades: number;
  todayPnl: number;
  todayWins: number;
  todayLosses: number;
  signalsReceived: number;
  signalsApproved: number;
  signalsRejected: number;
  lastSignalTime: string | null;
  lastTradeTime: string | null;
  errors: string[];
}

export interface PaperTrade {
  id: string;
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  setup_type: string;
  regime: string;
  direction: "long" | "short";
  signal_quality: number;
  win_probability: number;
  edge_score: number;
  kelly_fraction: number;
  status: "open" | "closed" | "cancelled";
  close_price?: number;
  close_time?: string;
  realized_pnl?: number;
  reason?: string;
}

export interface PaperTradingReport {
  generated_at: string;
  days: number;
  total_trades: number;
  winning_trades: number;
  losing_trades: number;
  win_rate: number;
  total_pnl: number;
  avg_pnl: number;
  best_trade: number;
  worst_trade: number;
  avg_trade_duration_ms: number;
  daily_breakdown: Array<{
    date: string;
    trades: number;
    pnl: number;
    wins: number;
    losses: number;
  }>;
}

// ── State ──────────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: PaperTradingConfig = {
  maxDailyTrades: 50,
  maxPositionSize: 10000,
  maxOpenPositions: 5,
  paperEquity: 100000,
  signalThreshold: 0.65,
  cooldownMs: 30000,
  sessionHoursUTC: [13, 20],
};

let _config = { ...DEFAULT_CONFIG };
let _state: PaperTradingState = {
  status: "idle",
  equity: DEFAULT_CONFIG.paperEquity,
  cash: DEFAULT_CONFIG.paperEquity,
  openPositions: 0,
  todayTrades: 0,
  todayPnl: 0,
  todayWins: 0,
  todayLosses: 0,
  signalsReceived: 0,
  signalsApproved: 0,
  signalsRejected: 0,
  lastSignalTime: null,
  lastTradeTime: null,
  errors: [],
};

let _lastTradeTime = 0;
let _sessionStartTime = 0;
let _dailyResetTime = 0;

// ── Initialization ─────────────────────────────────────────────────────────

function resetDailyMetrics(): void {
  _state.todayTrades = 0;
  _state.todayPnl = 0;
  _state.todayWins = 0;
  _state.todayLosses = 0;
  _dailyResetTime = Date.now();
}

function initializeStateFromDisk(): void {
  try {
    const trades = persistRead<PaperTrade[]>("paper_trades", []);
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    let openCount = 0;
    let todayPnl = 0;
    let todayTrades = 0;
    let todayWins = 0;
    let todayLosses = 0;

    for (const trade of trades) {
      const tradeDate = new Date(trade.timestamp);
      tradeDate.setHours(0, 0, 0, 0);

      if (tradeDate.getTime() === today.getTime()) {
        todayTrades++;
        if (trade.status === "open") openCount++;
        if (trade.realized_pnl) {
          todayPnl += trade.realized_pnl;
          if (trade.realized_pnl > 0) todayWins++;
          else todayLosses++;
        }
      }
    }

    _state.openPositions = openCount;
    _state.todayTrades = todayTrades;
    _state.todayPnl = todayPnl;
    _state.todayWins = todayWins;
    _state.todayLosses = todayLosses;
    _state.equity = _state.cash + todayPnl;
  } catch (err) {
    logger.warn({ err }, "[paper-trading] Failed to initialize state from disk");
  }
}

// ── Public API ──────────────────────────────────────────────────────────────

export function startPaperTrading(config?: Partial<PaperTradingConfig>): { success: boolean; message: string } {
  if (_state.status === "running") {
    return { success: false, message: "Paper trading already running" };
  }

  if (config) {
    _config = { ..._config, ...config };
  }

  _state.status = "running";
  _state.errors = [];
  _sessionStartTime = Date.now();

  // Initialize equity and cash from config
  _state.cash = _config.paperEquity;
  _state.equity = _config.paperEquity;

  resetDailyMetrics();
  initializeStateFromDisk();

  logger.info(
    { config: _config, equity: _state.equity },
    "[paper-trading] Paper trading started"
  );

  return { success: true, message: "Paper trading started" };
}

export function stopPaperTrading(): { success: boolean; message: string } {
  if (_state.status === "idle") {
    return { success: false, message: "Paper trading not running" };
  }

  // Close all open positions
  try {
    const trades = persistRead<PaperTrade[]>("paper_trades", []);
    const openTrades = trades.filter((t) => t.status === "open");

    for (const trade of openTrades) {
      const closedTrade: PaperTrade = {
        ...trade,
        status: "closed",
        close_time: new Date().toISOString(),
        close_price: trade.take_profit, // Close at TP for simplicity
        realized_pnl:
          trade.direction === "long"
            ? (trade.take_profit - trade.entry_price) * trade.quantity
            : (trade.entry_price - trade.take_profit) * trade.quantity,
        reason: "session_stop",
      };

      // Update the trade in persistent store
      const updatedTrades = trades.map((t) =>
        t.id === trade.id ? closedTrade : t
      );
      persistWrite("paper_trades", updatedTrades);
    }
  } catch (err) {
    logger.warn({ err }, "[paper-trading] Failed to close open positions");
  }

  _state.status = "idle";
  logger.info("[paper-trading] Paper trading stopped");

  return { success: true, message: "Paper trading stopped" };
}

export function pausePaperTrading(): { success: boolean; message: string } {
  if (_state.status !== "running") {
    return { success: false, message: "Paper trading not running" };
  }

  _state.status = "paused";
  logger.info("[paper-trading] Paper trading paused");

  return { success: true, message: "Paper trading paused" };
}

export function resumePaperTrading(): { success: boolean; message: string } {
  if (_state.status !== "paused") {
    return { success: false, message: "Paper trading not paused" };
  }

  _state.status = "running";
  logger.info("[paper-trading] Paper trading resumed");

  return { success: true, message: "Paper trading resumed" };
}

export function getPaperTradingState(): PaperTradingState {
  return { ..._state };
}

// ── Signal Processing ──────────────────────────────────────────────────────

export async function processPaperSignal(signal: SuperSignal & {
  symbol: string;
  setup_type: string;
  regime: string;
  direction: "long" | "short";
  entry_price: number;
  stop_loss: number;
  take_profit: number;
}): Promise<{ approved: boolean; reason: string; trade_id?: string }> {
  _state.signalsReceived++;
  const now = new Date();
  _state.lastSignalTime = now.toISOString();

  // 1. Check trading is running
  if (_state.status !== "running") {
    const reason = "Trading not running";
    _state.signalsRejected++;
    logger.warn({ symbol: signal.symbol, reason }, "[paper-trading] Signal rejected");
    return { approved: false, reason };
  }

  // 2. Check signal quality > threshold
  if (signal.enhanced_quality < _config.signalThreshold) {
    const reason = `Signal quality ${signal.enhanced_quality.toFixed(3)} < ${_config.signalThreshold}`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // 3. Check daily trade limit
  if (_state.todayTrades >= _config.maxDailyTrades) {
    const reason = `Daily trade limit (${_config.maxDailyTrades}) reached`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // 4. Check position limits
  if (_state.openPositions >= _config.maxOpenPositions) {
    const reason = `Max open positions (${_config.maxOpenPositions}) reached`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // Check position size
  const positionValue = signal.suggested_qty * signal.entry_price;
  if (positionValue > _config.maxPositionSize) {
    const reason = `Position size $${positionValue.toFixed(2)} > max $${_config.maxPositionSize}`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // 5. Check circuit breaker
  if (!isTradingAllowed()) {
    const breaker = getCircuitBreakerSnapshot();
    const reason = `Circuit breaker: ${breaker.breaker.tripReason || "Unknown"}`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // 6. Check cooldown
  const timeSinceLastTrade = Date.now() - _lastTradeTime;
  if (timeSinceLastTrade < _config.cooldownMs) {
    const reason = `Cooldown active: ${_config.cooldownMs - timeSinceLastTrade}ms remaining`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // 7. Check session hours
  const utcHour = now.getUTCHours();
  const [startHour, endHour] = _config.sessionHoursUTC;
  if (utcHour < startHour || utcHour >= endHour) {
    const reason = `Outside session hours (${startHour}-${endHour} UTC)`;
    _state.signalsRejected++;
    return { approved: false, reason };
  }

  // 8. Execute paper trade
  const tradeId = `pt_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;

  try {
    // Create execution request
    const execReq: ExecutionRequest = {
      symbol: signal.symbol,
      side: signal.direction === "long" ? "buy" : "sell",
      quantity: signal.suggested_qty,
      direction: signal.direction,
      setup_type: signal.setup_type,
      regime: signal.regime,
      entry_price: signal.entry_price,
      stop_loss: signal.stop_loss,
      take_profit: signal.take_profit,
      decision: {
        action: "EXECUTE",
        signal,
        quantity: signal.suggested_qty,
        dollar_risk: (Math.abs(signal.entry_price - signal.stop_loss) * signal.suggested_qty),
        block_reasons: [],
        meta: {
          kelly_pct: (signal.kelly_fraction * 100).toFixed(2),
          win_probability: signal.win_probability,
          edge_score: signal.edge_score,
          regime: signal.regime,
          confluence: signal.confluence_score,
          strategy_multiplier: 1.0,
          strategy_allocation_level: "standard",
        },
      } as any,
    };

    // Execute in paper mode (system mode should be paper)
    const result = await executeOrder(execReq);

    if (result.executed) {
      // 9. Record trade
      const trade: PaperTrade = {
        id: tradeId,
        timestamp: now.toISOString(),
        symbol: signal.symbol,
        side: execReq.side,
        quantity: signal.suggested_qty,
        entry_price: signal.entry_price,
        stop_loss: signal.stop_loss,
        take_profit: signal.take_profit,
        setup_type: signal.setup_type,
        regime: signal.regime,
        direction: signal.direction,
        signal_quality: signal.enhanced_quality,
        win_probability: signal.win_probability,
        edge_score: signal.edge_score,
        kelly_fraction: signal.kelly_fraction,
        status: "open",
      };

      try {
        persistAppend("paper_trades", trade, 10000);
      } catch (persistErr) {
        logger.error({ err: persistErr, tradeId }, "[paper-trading] Failed to persist trade");
      }

      // 10. Update state
      _state.todayTrades++;
      _state.openPositions++;
      _state.signalsApproved++;
      _lastTradeTime = Date.now();
      _state.lastTradeTime = now.toISOString();

      // Update cash
      const tradeValue = signal.suggested_qty * signal.entry_price;
      _state.cash -= tradeValue;
      _state.equity = _state.cash + _state.todayPnl;

      logger.info(
        { symbol: signal.symbol, qty: signal.suggested_qty, entry: signal.entry_price, tradeId },
        "[paper-trading] Paper trade executed"
      );

      return { approved: true, reason: "Trade executed", trade_id: tradeId };
    } else {
      const reason = `Execution failed: ${result.error || "Unknown error"}`;
      _state.signalsRejected++;
      return { approved: false, reason };
    }
  } catch (err) {
    const reason = err instanceof Error ? err.message : "Unknown error";
    _state.signalsRejected++;
    logger.error({ err, symbol: signal.symbol }, "[paper-trading] Signal processing failed");
    addError(reason);
    return { approved: false, reason };
  }
}

// ── Reporting ──────────────────────────────────────────────────────────────

export function getPaperTradingReport(days: number = 30): PaperTradingReport {
  try {
    const trades = persistRead<PaperTrade[]>("paper_trades", []);
    const cutoff = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

    const relevantTrades = trades.filter(
      (t) => new Date(t.timestamp) >= cutoff && t.status === "closed"
    );

    if (relevantTrades.length === 0) {
      return {
        generated_at: new Date().toISOString(),
        days,
        total_trades: 0,
        winning_trades: 0,
        losing_trades: 0,
        win_rate: 0,
        total_pnl: 0,
        avg_pnl: 0,
        best_trade: 0,
        worst_trade: 0,
        avg_trade_duration_ms: 0,
        daily_breakdown: [],
      };
    }

    let totalPnl = 0;
    let wins = 0;
    let losses = 0;
    let bestTrade = -Infinity;
    let worstTrade = Infinity;
    let totalDuration = 0;

    const dailyMap = new Map<
      string,
      { trades: number; pnl: number; wins: number; losses: number }
    >();

    for (const trade of relevantTrades) {
      const pnl = trade.realized_pnl || 0;
      totalPnl += pnl;
      bestTrade = Math.max(bestTrade, pnl);
      worstTrade = Math.min(worstTrade, pnl);

      if (pnl > 0) wins++;
      else if (pnl < 0) losses++;

      // Track duration
      if (trade.close_time) {
        const duration =
          new Date(trade.close_time).getTime() -
          new Date(trade.timestamp).getTime();
        totalDuration += duration;
      }

      // Daily breakdown
      const dateKey = new Date(trade.timestamp).toISOString().split("T")[0];
      const existing = dailyMap.get(dateKey) || {
        trades: 0,
        pnl: 0,
        wins: 0,
        losses: 0,
      };
      existing.trades++;
      existing.pnl += pnl;
      if (pnl > 0) existing.wins++;
      else if (pnl < 0) existing.losses++;
      dailyMap.set(dateKey, existing);
    }

    const daily_breakdown = Array.from(dailyMap.entries())
      .map(([date, data]) => ({
        date,
        ...data,
      }))
      .sort((a, b) => a.date.localeCompare(b.date));

    return {
      generated_at: new Date().toISOString(),
      days,
      total_trades: relevantTrades.length,
      winning_trades: wins,
      losing_trades: losses,
      win_rate: relevantTrades.length > 0 ? wins / relevantTrades.length : 0,
      total_pnl: totalPnl,
      avg_pnl: relevantTrades.length > 0 ? totalPnl / relevantTrades.length : 0,
      best_trade: isFinite(bestTrade) ? bestTrade : 0,
      worst_trade: isFinite(worstTrade) ? worstTrade : 0,
      avg_trade_duration_ms:
        relevantTrades.length > 0
          ? Math.round(totalDuration / relevantTrades.length)
          : 0,
      daily_breakdown,
    };
  } catch (err) {
    logger.error({ err, days }, "[paper-trading] Failed to generate report");
    return {
      generated_at: new Date().toISOString(),
      days,
      total_trades: 0,
      winning_trades: 0,
      losing_trades: 0,
      win_rate: 0,
      total_pnl: 0,
      avg_pnl: 0,
      best_trade: 0,
      worst_trade: 0,
      avg_trade_duration_ms: 0,
      daily_breakdown: [],
    };
  }
}

// ── Health Check ───────────────────────────────────────────────────────────

export function paperTradingHealthCheck(): {
  status: string;
  equity: number;
  daily_pnl: number;
  win_rate: number;
  open_positions: number;
  signal_approval_rate: number;
  errors: string[];
} {
  const totalSignals = _state.signalsReceived;
  const approvalRate =
    totalSignals > 0 ? _state.signalsApproved / totalSignals : 0;

  const todayTotalTrades = _state.todayWins + _state.todayLosses;
  const winRate =
    todayTotalTrades > 0 ? _state.todayWins / todayTotalTrades : 0;

  return {
    status: _state.status,
    equity: _state.equity,
    daily_pnl: _state.todayPnl,
    win_rate: winRate,
    open_positions: _state.openPositions,
    signal_approval_rate: approvalRate,
    errors: _state.errors.slice(-5),
  };
}

// ── Utilities ──────────────────────────────────────────────────────────────

function addError(msg: string): void {
  _state.errors.push(msg);
  if (_state.errors.length > 10) {
    _state.errors.shift();
  }
}

export function getPaperTradingConfig(): PaperTradingConfig {
  return { ..._config };
}

export function setPaperTradingConfig(
  config: Partial<PaperTradingConfig>
): PaperTradingConfig {
  _config = { ..._config, ...config };
  logger.info({ config: _config }, "[paper-trading] Config updated");
  return _config;
}
