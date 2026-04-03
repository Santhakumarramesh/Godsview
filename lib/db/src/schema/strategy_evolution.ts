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
 * Strategy Evolution — persisted per-symbol strategy params.
 * Survives server restarts. Each evolve cycle writes a new row (changelog).
 */
export const strategyParamsTable = pgTable("strategy_params", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  strategy_id: text("strategy_id").notNull(), // e.g. "SPY_v12"
  version: integer("version").notNull().default(1),
  tier: text("tier").notNull().default("SEED"), // SEED | LEARNING | PROVEN | ELITE | DEGRADING | SUSPENDED

  // Core params
  min_confirmation_score: numeric("min_confirmation_score", { precision: 5, scale: 4 }).notNull().default("0.6500"),
  require_mtf_alignment: boolean("require_mtf_alignment").notNull().default(false),
  require_bos: boolean("require_bos").notNull().default(true),
  min_ob_quality: numeric("min_ob_quality", { precision: 5, scale: 4 }).notNull().default("0.5000"),
  stop_atr_multiplier: numeric("stop_atr_multiplier", { precision: 5, scale: 3 }).notNull().default("1.500"),
  take_profit_atr_multiplier: numeric("take_profit_atr_multiplier", { precision: 5, scale: 3 }).notNull().default("3.000"),
  max_kelly_fraction: numeric("max_kelly_fraction", { precision: 5, scale: 4 }).notNull().default("0.2500"),

  // Regime rules stored as JSON arrays
  allowed_regimes: text("allowed_regimes"), // JSON string[]
  blacklisted_regimes: text("blacklisted_regimes"), // JSON string[]

  // Evolution metadata
  changelog: text("changelog"), // JSON ChangelogEntry[]
  is_active: boolean("is_active").notNull().default(true),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Trade Outcomes — every completed trade with full attribution.
 * Feeds super intelligence retraining and strategy evolution.
 */
export const tradeOutcomesTable = pgTable("trade_outcomes", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  strategy_id: text("strategy_id"),
  confirmation_id: text("confirmation_id"),
  direction: text("direction").notNull(), // LONG | SHORT

  // Setup context
  regime: text("regime"),
  mtf_aligned: boolean("mtf_aligned"),
  confirmation_score: numeric("confirmation_score", { precision: 5, scale: 4 }),
  ob_quality: numeric("ob_quality", { precision: 5, scale: 4 }),
  bos_confirmed: boolean("bos_confirmed"),
  fvg_present: boolean("fvg_present"),

  // Execution
  entry_price: numeric("entry_price", { precision: 14, scale: 6 }).notNull(),
  stop_loss: numeric("stop_loss", { precision: 14, scale: 6 }).notNull(),
  take_profit: numeric("take_profit", { precision: 14, scale: 6 }).notNull(),
  exit_price: numeric("exit_price", { precision: 14, scale: 6 }),
  quantity: numeric("quantity", { precision: 12, scale: 4 }),

  // Result
  outcome: text("outcome"), // WIN | LOSS | BREAKEVEN | PARTIAL
  pnl_usd: numeric("pnl_usd", { precision: 14, scale: 4 }),
  pnl_r: numeric("pnl_r", { precision: 8, scale: 4 }), // multiples of R
  mfe_r: numeric("mfe_r", { precision: 8, scale: 4 }), // max favorable excursion in R
  mae_r: numeric("mae_r", { precision: 8, scale: 4 }), // max adverse excursion in R
  hold_bars: integer("hold_bars"),

  // SI prediction vs actual (for Brier score tracking)
  si_win_probability: numeric("si_win_probability", { precision: 5, scale: 4 }),
  si_confidence: numeric("si_confidence", { precision: 5, scale: 4 }),
  si_model_votes: text("si_model_votes"), // JSON {m1..m5}

  // Timing
  entry_time: timestamp("entry_time", { withTimezone: true }),
  exit_time: timestamp("exit_time", { withTimezone: true }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Job History — completed and failed brain jobs for audit/analytics.
 */
export const jobHistoryTable = pgTable("job_history", {
  id: serial("id").primaryKey(),
  job_id: text("job_id").notNull(),
  job_type: text("job_type").notNull(),
  symbol: text("symbol"),
  priority: integer("priority").notNull().default(2),
  status: text("status").notNull(), // completed | failed | cancelled
  payload: text("payload"), // JSON
  result: text("result"), // JSON summary
  error: text("error"),
  queued_at: timestamp("queued_at", { withTimezone: true }),
  started_at: timestamp("started_at", { withTimezone: true }),
  completed_at: timestamp("completed_at", { withTimezone: true }),
  latency_ms: integer("latency_ms"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Chart Snapshots — persisted SVG chart images keyed by confirmationId.
 */
export const chartSnapshotsTable = pgTable("chart_snapshots", {
  id: serial("id").primaryKey(),
  confirmation_id: text("confirmation_id").notNull(),
  symbol: text("symbol").notNull(),
  direction: text("direction"),
  regime: text("regime"),
  confirmation_score: numeric("confirmation_score", { precision: 5, scale: 4 }),
  svg_chart: text("svg_chart").notNull(), // full SVG string
  html_report: text("html_report"), // optional HTML wrapper
  bar_count: integer("bar_count"),
  annotation_count: integer("annotation_count"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Super Intelligence Model State — persisted ensemble weights per symbol.
 * Allows SI to resume learning across restarts.
 */
export const siModelStateTable = pgTable("si_model_state", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  model_version: integer("model_version").notNull().default(1),
  // Ensemble weights
  weight_m1: numeric("weight_m1", { precision: 6, scale: 5 }).notNull().default("0.20000"), // Structure
  weight_m2: numeric("weight_m2", { precision: 6, scale: 5 }).notNull().default("0.20000"), // Regime
  weight_m3: numeric("weight_m3", { precision: 6, scale: 5 }).notNull().default("0.20000"), // Orderflow
  weight_m4: numeric("weight_m4", { precision: 6, scale: 5 }).notNull().default("0.20000"), // Memory
  weight_m5: numeric("weight_m5", { precision: 6, scale: 5 }).notNull().default("0.20000"), // Momentum
  // Platt calibration
  platt_a: numeric("platt_a", { precision: 8, scale: 5 }).notNull().default("1.00000"),
  platt_b: numeric("platt_b", { precision: 8, scale: 5 }).notNull().default("0.00000"),
  // Performance
  brier_score: numeric("brier_score", { precision: 6, scale: 5 }),
  total_outcomes: integer("total_outcomes").notNull().default(0),
  regime_calibration: text("regime_calibration"), // JSON Record<string, number>
  is_active: boolean("is_active").notNull().default(true),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// ── Insert schemas ────────────────────────────────────────────────────────────

export const insertStrategyParamsSchema = createInsertSchema(strategyParamsTable).omit({
  id: true, created_at: true, updated_at: true,
});
export const insertTradeOutcomeSchema = createInsertSchema(tradeOutcomesTable).omit({
  id: true, created_at: true,
});
export const insertJobHistorySchema = createInsertSchema(jobHistoryTable).omit({
  id: true, created_at: true,
});
export const insertChartSnapshotSchema = createInsertSchema(chartSnapshotsTable).omit({
  id: true, created_at: true,
});
export const insertSiModelStateSchema = createInsertSchema(siModelStateTable).omit({
  id: true, created_at: true, updated_at: true,
});

// ── Types ─────────────────────────────────────────────────────────────────────

export type StrategyParams = typeof strategyParamsTable.$inferSelect;
export type InsertStrategyParams = z.infer<typeof insertStrategyParamsSchema>;

export type TradeOutcome = typeof tradeOutcomesTable.$inferSelect;
export type InsertTradeOutcome = z.infer<typeof insertTradeOutcomeSchema>;

export type JobHistory = typeof jobHistoryTable.$inferSelect;
export type InsertJobHistory = z.infer<typeof insertJobHistorySchema>;

export type ChartSnapshot = typeof chartSnapshotsTable.$inferSelect;
export type InsertChartSnapshot = z.infer<typeof insertChartSnapshotSchema>;

export type SiModelState = typeof siModelStateTable.$inferSelect;
export type InsertSiModelState = z.infer<typeof insertSiModelStateSchema>;
