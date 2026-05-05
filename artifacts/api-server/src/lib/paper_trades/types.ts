/**
 * Phase 4 — Paper trading proof system types.
 *
 * Pure data shapes. No I/O. No dependency on Drizzle or HTTP.
 * The store layer (store.ts) maps between these types and the existing
 * `tradesTable` schema. The metrics/equity layers consume these types only.
 */

/** Outcome of a CLOSED trade. "open" while live; never returned by metrics. */
export type TradeOutcome = "open" | "win" | "loss" | "breakeven" | "expired" | "fallback_close";

export type TradeStatus = "submitted" | "open" | "closed" | "cancelled" | "rejected";

export interface ExecutedTrade {
  id: number;
  audit_id: string | null;
  broker_order_id: string | null;
  symbol: string;
  strategy_id: string;            // e.g. "ob_retest_long_1h"
  direction: "long" | "short";
  quantity: number;
  entry_price: number;
  stop_loss: number;              // planned (0 for closing-only orders)
  take_profit: number;            // planned (0 for closing-only orders)
  exit_price: number | null;      // null while open
  pnl: number | null;             // quote-currency PnL; null while open
  pnl_pct: number | null;         // PnL as % of equity at open; null while open
  realized_r: number | null;      // PnL / planned_risk_per_unit; null when planned risk = 0
  outcome: TradeOutcome;
  status: TradeStatus;
  entry_time: string;             // ISO
  exit_time: string | null;       // ISO; null while open
  mode: "paper" | "live" | "dry_run";
  bypass_reasons: ReadonlyArray<string>;
  closing: boolean;               // true if this was a position-close request
  /** Phase 5: equity at the moment the order opened. Null if unknown. */
  equity_at_entry: number | null;
}

export interface RejectedTrade {
  audit_id: string;
  timestamp: string;
  symbol: string;
  side: "buy" | "sell";
  direction: "long" | "short";
  quantity: number;
  entry_price: number;
  stop_loss: number;
  take_profit: number;
  bypass_reasons: ReadonlyArray<string>;
  blocking_gate: string;
  blocking_reason: string;
}

/** Result of metrics computation over a list of trades. All numbers computed, none hardcoded. */
export interface Metrics {
  // Counts
  total_executed: number;
  total_open: number;
  total_closed: number;
  total_wins: number;
  total_losses: number;
  total_breakevens: number;
  total_rejected: number;
  // Ratios
  win_rate: number | null;        // wins / closed; null if closed === 0
  loss_rate: number | null;
  // Magnitudes
  avg_r: number | null;           // mean realized_R across closed trades with non-zero planned risk; null otherwise
  median_r: number | null;
  best_r: number | null;
  worst_r: number | null;
  // Money
  total_pnl: number;              // sum of closed PnL (quote currency)
  avg_pnl_per_trade: number | null;
  profit_factor: number | null;   // sum(positive PnL) / |sum(negative PnL)|; null if no losses
  max_drawdown_pct: number | null; // peak-to-trough % drop on equity curve
  max_drawdown_abs: number | null; // peak-to-trough $ drop
  // Window
  first_trade_at: string | null;
  last_trade_at: string | null;
  computed_at: string;
}

export interface EquityPoint {
  timestamp: string;              // exit_time of the trade
  trade_id: number;
  pnl: number;                    // realised PnL contributed by this trade
  equity: number;                 // cumulative equity AFTER this trade
}

export interface EquityCurve {
  starting_equity: number;
  starting_at: string | null;     // ISO of first trade open; null if no trades
  points: EquityPoint[];
  ending_equity: number;
}
