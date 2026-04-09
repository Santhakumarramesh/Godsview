import { randomUUID } from "crypto";

export interface ShadowConfig {
  duration_hours: number;
  max_trades: number;
  symbols: string[];
  compare_with_live: boolean;
}

export interface ShadowTrade {
  id: string;
  session_id: string;
  signal_timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  quantity: number;
  signal_price: number;
  market_price_at_signal: number;
  market_price_after_1m: number;
  market_price_after_5m: number;
  would_have_pnl: number;
  slippage_estimate_bps: number;
  decision_rationale: string;
}

export interface ShadowMetrics {
  total_signals: number;
  total_would_have_pnl: number;
  win_count: number;
  loss_count: number;
  win_rate: number;
  avg_slippage_bps: number;
  best_trade_pnl: number;
  worst_trade_pnl: number;
  sharpe_estimate: number;
  max_drawdown_pct: number;
}

export interface ShadowSession {
  id: string;
  strategy_id: string;
  strategy_name: string;
  status: "active" | "paused" | "completed" | "aborted";
  started_at: string;
  ended_at?: string;
  config: ShadowConfig;
  trades: ShadowTrade[];
  metrics?: ShadowMetrics;
}

export interface ShadowComparison {
  id: string;
  session_id: string;
  generated_at: string;
  shadow_pnl: number;
  live_pnl: number;
  divergence: number;
  divergence_pct: number;
  shadow_trades: number;
  live_trades: number;
  trade_overlap_pct: number;
  verdict: "shadow_better" | "live_better" | "comparable" | "insufficient_data";
  confidence: number;
  recommendation: string;
}

export interface ShadowStatTest {
  metric: string;
  shadow_value: number;
  live_value: number;
  difference: number;
  significant: boolean;
  p_value_proxy: number;
}

// In-memory storage
const shadowSessions = new Map<string, ShadowSession>();
const shadowComparisons = new Map<string, ShadowComparison>();

// Helper function to generate ID with semantic prefix
function generateId(prefix: string): string {
  return `${prefix}_${randomUUID()}`;
}

// Helper function to compute standard deviation
function stddev(values: number[]): number {
  if (values.length === 0) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance =
    values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) /
    values.length;
  return Math.sqrt(variance);
}

// Helper function to compute max drawdown
function computeMaxDrawdown(trades: ShadowTrade[]): number {
  if (trades.length === 0) return 0;

  let peak = 0;
  let maxDrawdown = 0;
  let cumulativePnl = 0;

  for (const trade of trades) {
    cumulativePnl += trade.would_have_pnl;
    if (cumulativePnl > peak) {
      peak = cumulativePnl;
    }
    const drawdown = ((peak - cumulativePnl) / Math.max(peak, 1)) * 100;
    if (drawdown > maxDrawdown) {
      maxDrawdown = drawdown;
    }
  }

  return maxDrawdown;
}

// Helper function to compute Sharpe estimate
function computeSharpeEstimate(trades: ShadowTrade[]): number {
  if (trades.length === 0) return 0;

  const pnls = trades.map((t) => t.would_have_pnl);
  const mean = pnls.reduce((a, b) => a + b, 0) / pnls.length;
  const sd = stddev(pnls);

  if (sd === 0) return 0;
  return (mean / sd) * Math.sqrt(252);
}

export function createShadowSession(config: {
  strategy_id: string;
  strategy_name: string;
  config: ShadowConfig;
}): ShadowSession {
  const session: ShadowSession = {
    id: generateId("ss"),
    strategy_id: config.strategy_id,
    strategy_name: config.strategy_name,
    status: "active",
    started_at: new Date().toISOString(),
    config: config.config,
    trades: [],
  };

  shadowSessions.set(session.id, session);
  return session;
}

export function recordShadowTrade(
  session_id: string,
  trade: Omit<
    ShadowTrade,
    "id" | "session_id" | "would_have_pnl" | "slippage_estimate_bps"
  > & { would_have_pnl?: number }
): { success: boolean; data?: ShadowTrade; error?: string } {
  const session = shadowSessions.get(session_id);
  if (!session) {
    return { success: false, error: `Session ${session_id} not found` };
  }

  if (session.status !== "active") {
    return {
      success: false,
      error: `Session is ${session.status}, cannot record trades`,
    };
  }

  if (session.trades.length >= session.config.max_trades) {
    return {
      success: false,
      error: `Max trades (${session.config.max_trades}) reached`,
    };
  }

  // Auto-compute would_have_pnl if not provided
  let would_have_pnl = trade.would_have_pnl ?? 0;
  if (trade.would_have_pnl === undefined) {
    if (trade.side === "buy") {
      would_have_pnl =
        (trade.market_price_after_5m - trade.signal_price) * trade.quantity;
    } else {
      would_have_pnl =
        (trade.signal_price - trade.market_price_after_5m) * trade.quantity;
    }
  }

  // Auto-compute slippage_estimate_bps
  const slippage_estimate_bps =
    (Math.abs(trade.market_price_at_signal - trade.signal_price) /
      trade.signal_price) *
    10000;

  const shadowTrade: ShadowTrade = {
    id: generateId("st"),
    session_id,
    signal_timestamp: trade.signal_timestamp,
    symbol: trade.symbol,
    side: trade.side,
    quantity: trade.quantity,
    signal_price: trade.signal_price,
    market_price_at_signal: trade.market_price_at_signal,
    market_price_after_1m: trade.market_price_after_1m,
    market_price_after_5m: trade.market_price_after_5m,
    would_have_pnl,
    slippage_estimate_bps,
    decision_rationale: trade.decision_rationale,
  };

  session.trades.push(shadowTrade);
  return { success: true, data: shadowTrade };
}

export function completeShadowSession(
  session_id: string
): { success: boolean; data?: ShadowMetrics; error?: string } {
  const session = shadowSessions.get(session_id);
  if (!session) {
    return { success: false, error: `Session ${session_id} not found` };
  }

  session.status = "completed";
  session.ended_at = new Date().toISOString();

  const trades = session.trades;
  const total_signals = trades.length;

  if (total_signals === 0) {
    const emptyMetrics: ShadowMetrics = {
      total_signals: 0,
      total_would_have_pnl: 0,
      win_count: 0,
      loss_count: 0,
      win_rate: 0,
      avg_slippage_bps: 0,
      best_trade_pnl: 0,
      worst_trade_pnl: 0,
      sharpe_estimate: 0,
      max_drawdown_pct: 0,
    };
    session.metrics = emptyMetrics;
    return { success: true, data: emptyMetrics };
  }

  const pnls = trades.map((t) => t.would_have_pnl);
  const total_would_have_pnl = pnls.reduce((a, b) => a + b, 0);
  const win_count = pnls.filter((p) => p > 0).length;
  const loss_count = pnls.filter((p) => p < 0).length;
  const win_rate = total_signals > 0 ? win_count / total_signals : 0;

  const slippages = trades.map((t) => t.slippage_estimate_bps);
  const avg_slippage_bps =
    slippages.reduce((a, b) => a + b, 0) / slippages.length;

  const best_trade_pnl = Math.max(...pnls);
  const worst_trade_pnl = Math.min(...pnls);

  const sharpe_estimate = computeSharpeEstimate(trades);
  const max_drawdown_pct = computeMaxDrawdown(trades);

  const metrics: ShadowMetrics = {
    total_signals,
    total_would_have_pnl,
    win_count,
    loss_count,
    win_rate,
    avg_slippage_bps,
    best_trade_pnl,
    worst_trade_pnl,
    sharpe_estimate,
    max_drawdown_pct,
  };

  session.metrics = metrics;
  return { success: true, data: metrics };
}

export function pauseShadowSession(
  session_id: string
): { success: boolean; error?: string } {
  const session = shadowSessions.get(session_id);
  if (!session) {
    return { success: false, error: `Session ${session_id} not found` };
  }

  if (session.status !== "active") {
    return {
      success: false,
      error: `Session is ${session.status}, cannot pause`,
    };
  }

  session.status = "paused";
  return { success: true };
}

export function resumeShadowSession(
  session_id: string
): { success: boolean; error?: string } {
  const session = shadowSessions.get(session_id);
  if (!session) {
    return { success: false, error: `Session ${session_id} not found` };
  }

  if (session.status !== "paused") {
    return {
      success: false,
      error: `Session is ${session.status}, can only resume paused sessions`,
    };
  }

  session.status = "active";
  return { success: true };
}

export function abortShadowSession(
  session_id: string
): { success: boolean; error?: string } {
  const session = shadowSessions.get(session_id);
  if (!session) {
    return { success: false, error: `Session ${session_id} not found` };
  }

  session.status = "aborted";
  session.ended_at = new Date().toISOString();
  return { success: true };
}

export function getShadowSession(id: string): ShadowSession | undefined {
  return shadowSessions.get(id);
}

export function getActiveSessions(): ShadowSession[] {
  return Array.from(shadowSessions.values()).filter(
    (s) => s.status === "active"
  );
}

export function getAllSessions(limit?: number): ShadowSession[] {
  const sessions = Array.from(shadowSessions.values());
  if (limit) {
    return sessions.slice(-limit);
  }
  return sessions;
}

export function getSessionsByStrategy(strategy_id: string): ShadowSession[] {
  return Array.from(shadowSessions.values()).filter(
    (s) => s.strategy_id === strategy_id
  );
}

export function compareShadowToLive(
  session_id: string,
  live_pnl: number,
  live_trades: number
): { success: boolean; data?: ShadowComparison; error?: string } {
  const session = shadowSessions.get(session_id);
  if (!session) {
    return { success: false, error: `Session ${session_id} not found` };
  }

  const shadow_pnl = session.metrics?.total_would_have_pnl ?? 0;
  const shadow_trades = session.trades.length;

  if (shadow_trades === 0 || live_trades === 0) {
    const comparison: ShadowComparison = {
      id: generateId("sc"),
      session_id,
      generated_at: new Date().toISOString(),
      shadow_pnl,
      live_pnl,
      divergence: shadow_pnl - live_pnl,
      divergence_pct:
        Math.abs(shadow_pnl) > 0
          ? ((shadow_pnl - live_pnl) / Math.abs(shadow_pnl)) * 100
          : 0,
      shadow_trades,
      live_trades,
      trade_overlap_pct: 0,
      verdict: "insufficient_data",
      confidence: 0,
      recommendation:
        "Insufficient data to compare. Run both shadow and live sessions with trades.",
    };
    shadowComparisons.set(comparison.id, comparison);
    return { success: true, data: comparison };
  }

  const divergence = shadow_pnl - live_pnl;
  const divergence_pct =
    ((shadow_pnl - live_pnl) / Math.max(Math.abs(shadow_pnl), 1)) * 100;
  const trade_overlap_pct =
    ((Math.min(shadow_trades, live_trades) / Math.max(shadow_trades, 1)) *
      100) |
    0;

  let verdict: "shadow_better" | "live_better" | "comparable" | "insufficient_data";
  let recommendation: string;

  if (Math.abs(divergence_pct) < 5) {
    verdict = "comparable";
    recommendation =
      "Shadow and live performance are comparable. Strategy is consistent.";
  } else if (shadow_pnl > live_pnl) {
    verdict = "shadow_better";
    recommendation =
      "Shadow performance exceeded live. Review live execution for slippage or timing issues.";
  } else {
    verdict = "live_better";
    recommendation =
      "Live performance exceeded shadow. Market conditions or execution timing may be advantageous.";
  }

  const comparison: ShadowComparison = {
    id: generateId("sc"),
    session_id,
    generated_at: new Date().toISOString(),
    shadow_pnl,
    live_pnl,
    divergence,
    divergence_pct,
    shadow_trades,
    live_trades,
    trade_overlap_pct,
    verdict,
    confidence: Math.min(100, (trade_overlap_pct * (100 - Math.abs(divergence_pct))) / 100),
    recommendation,
  };

  shadowComparisons.set(comparison.id, comparison);
  return { success: true, data: comparison };
}

export function runStatisticalTest(
  session_id: string,
  live_metrics: { pnl: number; win_rate: number; sharpe: number }
): ShadowStatTest[] {
  const session = shadowSessions.get(session_id);
  if (!session || !session.metrics) {
    return [];
  }

  const metrics = session.metrics;

  const pnlTest: ShadowStatTest = {
    metric: "pnl",
    shadow_value: metrics.total_would_have_pnl,
    live_value: live_metrics.pnl,
    difference: metrics.total_would_have_pnl - live_metrics.pnl,
    significant: false,
    p_value_proxy: 0,
  };

  const maxVal = Math.max(
    Math.abs(metrics.total_would_have_pnl),
    Math.abs(live_metrics.pnl),
    1
  );
  pnlTest.p_value_proxy =
    1 - Math.min(1, Math.abs(pnlTest.difference) / maxVal);
  pnlTest.significant = pnlTest.p_value_proxy < 0.05;

  const winRateTest: ShadowStatTest = {
    metric: "win_rate",
    shadow_value: metrics.win_rate,
    live_value: live_metrics.win_rate,
    difference: metrics.win_rate - live_metrics.win_rate,
    significant: false,
    p_value_proxy: 0,
  };

  const maxWr = Math.max(metrics.win_rate, live_metrics.win_rate, 0.01);
  winRateTest.p_value_proxy =
    1 - Math.min(1, Math.abs(winRateTest.difference) / maxWr);
  winRateTest.significant = winRateTest.p_value_proxy < 0.05;

  const sharpeTest: ShadowStatTest = {
    metric: "sharpe",
    shadow_value: metrics.sharpe_estimate,
    live_value: live_metrics.sharpe,
    difference: metrics.sharpe_estimate - live_metrics.sharpe,
    significant: false,
    p_value_proxy: 0,
  };

  const maxSharpe = Math.max(
    Math.abs(metrics.sharpe_estimate),
    Math.abs(live_metrics.sharpe),
    1
  );
  sharpeTest.p_value_proxy =
    1 - Math.min(1, Math.abs(sharpeTest.difference) / maxSharpe);
  sharpeTest.significant = sharpeTest.p_value_proxy < 0.05;

  return [pnlTest, winRateTest, sharpeTest];
}

export function _clearShadowTrading(): void {
  shadowSessions.clear();
  shadowComparisons.clear();
}
