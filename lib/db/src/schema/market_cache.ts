import { pgTable, serial, text, numeric, timestamp, integer } from "drizzle-orm/pg-core";

export const marketBarsTable = pgTable("market_bars", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  bar_time: timestamp("bar_time", { withTimezone: true }).notNull(),
  open: numeric("open", { precision: 14, scale: 6 }).notNull(),
  high: numeric("high", { precision: 14, scale: 6 }).notNull(),
  low: numeric("low", { precision: 14, scale: 6 }).notNull(),
  close: numeric("close", { precision: 14, scale: 6 }).notNull(),
  volume: numeric("volume", { precision: 18, scale: 2 }).notNull(),
  vwap: numeric("vwap", { precision: 14, scale: 6 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const accuracyResultsTable = pgTable("accuracy_results", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  setup_type: text("setup_type").notNull(),
  timeframe: text("timeframe").notNull(),
  bar_time: timestamp("bar_time", { withTimezone: true }).notNull(),
  signal_detected: text("signal_detected").notNull(),
  structure_score: numeric("structure_score", { precision: 5, scale: 4 }).notNull(),
  order_flow_score: numeric("order_flow_score", { precision: 5, scale: 4 }).notNull(),
  recall_score: numeric("recall_score", { precision: 5, scale: 4 }).notNull(),
  final_quality: numeric("final_quality", { precision: 5, scale: 4 }).notNull(),
  outcome: text("outcome"),
  tp_ticks: integer("tp_ticks"),
  sl_ticks: integer("sl_ticks"),
  hit_tp: text("hit_tp"),
  forward_bars_checked: integer("forward_bars_checked"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type MarketBar = typeof marketBarsTable.$inferSelect;
export type AccuracyResult = typeof accuracyResultsTable.$inferSelect;
