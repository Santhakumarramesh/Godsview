import {
  pgTable,
  serial,
  text,
  numeric,
  timestamp,
  integer,
  boolean,
  jsonb,
  bigint,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 93 — Data Engine Tables
 * Order book snapshots, tick-level data, volume delta, and multi-source feeds.
 */

/** Level 2 order book snapshots */
export const orderBookSnapshotsTable = pgTable("order_book_snapshots", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  exchange: text("exchange").notNull().default("alpaca"),
  bids: text("bids").notNull(), // JSON array of [price, size] tuples
  asks: text("asks").notNull(), // JSON array of [price, size] tuples
  bid_depth_10: numeric("bid_depth_10", { precision: 18, scale: 2 }),
  ask_depth_10: numeric("ask_depth_10", { precision: 18, scale: 2 }),
  imbalance_ratio: numeric("imbalance_ratio", { precision: 8, scale: 6 }),
  spread_bps: numeric("spread_bps", { precision: 8, scale: 4 }),
  midpoint: numeric("midpoint", { precision: 14, scale: 6 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Tick-level trade data */
export const tickDataTable = pgTable("tick_data", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  price: numeric("price", { precision: 14, scale: 6 }).notNull(),
  size: numeric("size", { precision: 18, scale: 2 }).notNull(),
  side: text("side").notNull(), // buy | sell | unknown
  exchange: text("exchange"),
  conditions: text("conditions"), // JSON string[] of trade conditions
  is_aggressive: boolean("is_aggressive").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Volume delta aggregated by timeframe */
export const volumeDeltaTable = pgTable("volume_delta", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(), // 1m, 5m, 15m, etc.
  bar_time: timestamp("bar_time", { withTimezone: true }).notNull(),
  buy_volume: numeric("buy_volume", { precision: 18, scale: 2 }).notNull(),
  sell_volume: numeric("sell_volume", { precision: 18, scale: 2 }).notNull(),
  delta: numeric("delta", { precision: 18, scale: 2 }).notNull(), // buy - sell
  cumulative_delta: numeric("cumulative_delta", { precision: 18, scale: 2 }).notNull(),
  delta_percent: numeric("delta_percent", { precision: 8, scale: 4 }),
  max_single_trade: numeric("max_single_trade", { precision: 18, scale: 2 }),
  trade_count: integer("trade_count").notNull().default(0),
  aggressive_buy_pct: numeric("aggressive_buy_pct", { precision: 5, scale: 4 }),
  aggressive_sell_pct: numeric("aggressive_sell_pct", { precision: 5, scale: 4 }),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Multi-source data feed status */
export const dataFeedStatusTable = pgTable("data_feed_status", {
  id: serial("id").primaryKey(),
  feed_name: text("feed_name").notNull(), // alpaca_ws, yahoo, fred, news_api, etc.
  feed_type: text("feed_type").notNull(), // price, orderbook, macro, sentiment, fundamental
  status: text("status").notNull().default("disconnected"), // connected, disconnected, degraded, error
  last_message_at: timestamp("last_message_at", { withTimezone: true }),
  messages_per_minute: numeric("messages_per_minute", { precision: 10, scale: 2 }),
  error_count: integer("error_count").notNull().default(0),
  last_error: text("last_error"),
  metadata: text("metadata"), // JSON additional info
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Footprint / heatmap data per price level per bar */
export const footprintDataTable = pgTable("footprint_data", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  timeframe: text("timeframe").notNull(),
  bar_time: timestamp("bar_time", { withTimezone: true }).notNull(),
  price_level: numeric("price_level", { precision: 14, scale: 6 }).notNull(),
  bid_volume: numeric("bid_volume", { precision: 18, scale: 2 }).notNull(),
  ask_volume: numeric("ask_volume", { precision: 18, scale: 2 }).notNull(),
  delta: numeric("delta", { precision: 18, scale: 2 }).notNull(),
  is_poc: boolean("is_poc").notNull().default(false), // point of control
  is_high_volume_node: boolean("is_high_volume_node").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Macro / sentiment data from external sources */
export const macroDataTable = pgTable("macro_data", {
  id: serial("id").primaryKey(),
  source: text("source").notNull(), // fred, quiver, news_api, finviz
  indicator: text("indicator").notNull(), // VIX, DXY, US10Y, etc.
  ts: timestamp("ts", { withTimezone: true }).notNull(),
  value: numeric("value", { precision: 18, scale: 6 }).notNull(),
  previous_value: numeric("previous_value", { precision: 18, scale: 6 }),
  change_pct: numeric("change_pct", { precision: 8, scale: 4 }),
  sentiment_impact: text("sentiment_impact"), // bullish, bearish, neutral
  metadata: text("metadata"), // JSON
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Insert schemas
export const insertOrderBookSnapshotSchema = createInsertSchema(orderBookSnapshotsTable).omit({ id: true, created_at: true });
export const insertTickDataSchema = createInsertSchema(tickDataTable).omit({ id: true, created_at: true });
export const insertVolumeDeltaSchema = createInsertSchema(volumeDeltaTable).omit({ id: true, created_at: true });
export const insertDataFeedStatusSchema = createInsertSchema(dataFeedStatusTable).omit({ id: true, created_at: true, updated_at: true });
export const insertFootprintDataSchema = createInsertSchema(footprintDataTable).omit({ id: true, created_at: true });
export const insertMacroDataSchema = createInsertSchema(macroDataTable).omit({ id: true, created_at: true });

// Types
export type OrderBookSnapshot = typeof orderBookSnapshotsTable.$inferSelect;
export type InsertOrderBookSnapshot = z.infer<typeof insertOrderBookSnapshotSchema>;
export type TickData = typeof tickDataTable.$inferSelect;
export type InsertTickData = z.infer<typeof insertTickDataSchema>;
export type VolumeDelta = typeof volumeDeltaTable.$inferSelect;
export type InsertVolumeDelta = z.infer<typeof insertVolumeDeltaSchema>;
export type DataFeedStatus = typeof dataFeedStatusTable.$inferSelect;
export type InsertDataFeedStatus = z.infer<typeof insertDataFeedStatusSchema>;
export type FootprintData = typeof footprintDataTable.$inferSelect;
export type InsertFootprintData = z.infer<typeof insertFootprintDataSchema>;
export type MacroData = typeof macroDataTable.$inferSelect;
export type InsertMacroData = z.infer<typeof insertMacroDataSchema>;
