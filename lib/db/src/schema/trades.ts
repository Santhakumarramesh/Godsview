import { pgTable, serial, text, numeric, timestamp, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const tradesTable = pgTable("trades", {
  id: serial("id").primaryKey(),
  signal_id: integer("signal_id"),
  instrument: text("instrument").notNull(),
  setup_type: text("setup_type").notNull(),
  direction: text("direction").notNull(),
  entry_price: numeric("entry_price", { precision: 12, scale: 4 }).notNull(),
  exit_price: numeric("exit_price", { precision: 12, scale: 4 }),
  stop_loss: numeric("stop_loss", { precision: 12, scale: 4 }).notNull(),
  take_profit: numeric("take_profit", { precision: 12, scale: 4 }).notNull(),
  quantity: numeric("quantity", { precision: 10, scale: 4 }).notNull(),
  pnl: numeric("pnl", { precision: 12, scale: 4 }),
  pnl_pct: numeric("pnl_pct", { precision: 8, scale: 4 }),
  outcome: text("outcome").notNull().default("open"),
  mfe: numeric("mfe", { precision: 12, scale: 4 }),
  mae: numeric("mae", { precision: 12, scale: 4 }),
  slippage: numeric("slippage", { precision: 8, scale: 4 }),
  session: text("session"),
  regime: text("regime"),
  notes: text("notes"),
  entry_time: timestamp("entry_time", { withTimezone: true }),
  exit_time: timestamp("exit_time", { withTimezone: true }),
  status: text("status").notNull().default("pending"),
  rejection_reason: text("rejection_reason"),
  org_id: text("org_id"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradeSchema = createInsertSchema(tradesTable).omit({ id: true, created_at: true });
export type InsertTrade = z.infer<typeof insertTradeSchema>;
export type Trade = typeof tradesTable.$inferSelect;
