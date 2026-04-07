import { pgTable, uuid, text, timestamp, doublePrecision, pgEnum } from "drizzle-orm/pg-core";

export const orderSideEnum = pgEnum("order_side", ["buy", "sell"]);
export const orderTypeEnum = pgEnum("order_type", ["market", "limit", "stop", "stop_limit"]);
export const orderTifEnum = pgEnum("order_tif", ["day", "gtc", "ioc", "fok"]);
export const orderStatusEnum = pgEnum("order_status", ["pending", "submitted", "partial", "filled", "cancelled", "rejected"]);

export const ordersTable = pgTable("orders", {
  order_id: uuid("order_id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  side: orderSideEnum("side").notNull(),
  order_type: orderTypeEnum("order_type").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  price: doublePrecision("price"),
  stop_price: doublePrecision("stop_price"),
  time_in_force: orderTifEnum("time_in_force").notNull().default("day"),
  status: orderStatusEnum("status").notNull().default("pending"),
  filled_qty: doublePrecision("filled_qty").notNull().default(0),
  avg_fill_price: doublePrecision("avg_fill_price"),
  signal_id: uuid("signal_id"),
  broker: text("broker").notNull().default("alpaca"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Order = typeof ordersTable.$inferSelect;
export type NewOrder = typeof ordersTable.$inferInsert;
