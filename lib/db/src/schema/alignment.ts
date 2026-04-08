import {
  pgTable,
  serial,
  text,
  numeric,
  boolean,
  timestamp,
  integer,
  jsonb,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Backtest↔Live Alignment Snapshots — periodic comparison of
 * backtest assumptions vs actual execution outcomes.
 *
 * Each row = one alignment check for a (strategy, symbol, period) tuple.
 */
export const alignmentSnapshotsTable = pgTable("alignment_snapshots", {
  id: serial("id").primaryKey(),
  strategy_id: text("strategy_id").notNull(),
  symbol: text("symbol"),                         // null = strategy-wide aggregate
  period_start: timestamp("period_start").notNull(),
  period_end: timestamp("period_end").notNull(),
  // Backtest assumptions
  bt_win_rate: numeric("bt_win_rate", { precision: 6, scale: 4 }),
  bt_avg_pnl: numeric("bt_avg_pnl", { precision: 12, scale: 4 }),
  bt_sharpe: numeric("bt_sharpe", { precision: 8, scale: 4 }),
  bt_max_drawdown_pct: numeric("bt_max_drawdown_pct", { precision: 8, scale: 4 }),
  bt_avg_slippage_bps: numeric("bt_avg_slippage_bps", { precision: 8, scale: 2 }),
  bt_trade_count: integer("bt_trade_count"),

  // Live execution reality (from execution truth layer)
  live_win_rate: numeric("live_win_rate", { precision: 6, scale: 4 }),
  live_avg_pnl: numeric("live_avg_pnl", { precision: 12, scale: 4 }),
  live_sharpe: numeric("live_sharpe", { precision: 8, scale: 4 }),
  live_max_drawdown_pct: numeric("live_max_drawdown_pct", { precision: 8, scale: 4 }),
  live_avg_slippage_bps: numeric("live_avg_slippage_bps", { precision: 8, scale: 2 }),
  live_trade_count: integer("live_trade_count"),

  // Alignment scores (0 = perfect alignment, 1 = total divergence)
  win_rate_divergence: numeric("win_rate_divergence", { precision: 8, scale: 4 }),
  pnl_divergence: numeric("pnl_divergence", { precision: 8, scale: 4 }),
  sharpe_divergence: numeric("sharpe_divergence", { precision: 8, scale: 4 }),
  slippage_divergence: numeric("slippage_divergence", { precision: 8, scale: 4 }),
  composite_alignment_score: numeric("composite_alignment_score", { precision: 6, scale: 4 }), // 0-1, higher = better

  // Verdicts
  verdict: text("verdict").notNull(), // aligned | drifting | diverged | insufficient_data
  drift_direction: text("drift_direction"),        // backtest_optimistic | backtest_pessimistic | mixed
  regime: text("regime"),
  // Context
  details_json: jsonb("details_json"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Slippage Calibration — tracks how backtest slippage assumptions
 * compare to real execution slippage over time.
 *
 * Used to adjust backtest slippage models for more realistic simulations.
 */
export const slippageCalibrationTable = pgTable("slippage_calibration", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  period_start: timestamp("period_start").notNull(),
  period_end: timestamp("period_end").notNull(),

  // Assumed slippage (what backtest uses)
  assumed_slippage_bps: numeric("assumed_slippage_bps", { precision: 8, scale: 2 }),

  // Actual slippage (from fills table)
  actual_avg_slippage_bps: numeric("actual_avg_slippage_bps", { precision: 8, scale: 2 }),
  actual_p50_slippage_bps: numeric("actual_p50_slippage_bps", { precision: 8, scale: 2 }),
  actual_p95_slippage_bps: numeric("actual_p95_slippage_bps", { precision: 8, scale: 2 }),
  actual_max_slippage_bps: numeric("actual_max_slippage_bps", { precision: 8, scale: 2 }),
  fill_count: integer("fill_count"),
  // Calibration
  calibration_error_bps: numeric("calibration_error_bps", { precision: 8, scale: 2 }), // assumed - actual
  recommended_slippage_bps: numeric("recommended_slippage_bps", { precision: 8, scale: 2 }),
  is_calibrated: boolean("is_calibrated").default(false),

  regime: text("regime"),
  setup_type: text("setup_type"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Drift Events — discrete events when alignment degrades past thresholds.
 * Used for alerting and strategy governance decisions.
 */
export const driftEventsTable = pgTable("drift_events", {
  id: serial("id").primaryKey(),
  strategy_id: text("strategy_id").notNull(),
  symbol: text("symbol"),
  event_type: text("event_type").notNull(), // win_rate_drift | pnl_drift | sharpe_drift | slippage_drift | composite_drift
  severity: text("severity").notNull(),      // warning | critical

  // What triggered it
  metric_name: text("metric_name").notNull(),
  backtest_value: numeric("backtest_value", { precision: 12, scale: 4 }),
  live_value: numeric("live_value", { precision: 12, scale: 4 }),
  divergence: numeric("divergence", { precision: 8, scale: 4 }),
  threshold: numeric("threshold", { precision: 8, scale: 4 }),
  // Actions taken
  action_taken: text("action_taken"),  // none | alert | pause_strategy | demote_tier
  resolved: boolean("resolved").default(false),
  resolved_at: timestamp("resolved_at"),
  notes: text("notes"),

  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Zod schemas
export const insertAlignmentSnapshotSchema = createInsertSchema(alignmentSnapshotsTable);
export const insertSlippageCalibrationSchema = createInsertSchema(slippageCalibrationTable);
export const insertDriftEventSchema = createInsertSchema(driftEventsTable);

// Types
export type AlignmentSnapshot = typeof alignmentSnapshotsTable.$inferSelect;
export type InsertAlignmentSnapshot = z.infer<typeof insertAlignmentSnapshotSchema>;
export type SlippageCalibration = typeof slippageCalibrationTable.$inferSelect;
export type InsertSlippageCalibration = z.infer<typeof insertSlippageCalibrationSchema>;
export type DriftEvent = typeof driftEventsTable.$inferSelect;
export type InsertDriftEvent = z.infer<typeof insertDriftEventSchema>;
