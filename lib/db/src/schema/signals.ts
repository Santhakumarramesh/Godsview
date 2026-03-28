import { pgTable, serial, text, numeric, timestamp, boolean } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const signalsTable = pgTable("signals", {
  id: serial("id").primaryKey(),
  instrument: text("instrument").notNull(),
  setup_type: text("setup_type").notNull(),
  status: text("status").notNull().default("pending"),
  structure_score: numeric("structure_score", { precision: 5, scale: 4 }).notNull(),
  order_flow_score: numeric("order_flow_score", { precision: 5, scale: 4 }).notNull(),
  recall_score: numeric("recall_score", { precision: 5, scale: 4 }).notNull(),
  ml_probability: numeric("ml_probability", { precision: 5, scale: 4 }).notNull(),
  claude_score: numeric("claude_score", { precision: 5, scale: 4 }).notNull(),
  final_quality: numeric("final_quality", { precision: 5, scale: 4 }).notNull(),
  claude_verdict: text("claude_verdict"),
  claude_reasoning: text("claude_reasoning"),
  entry_price: numeric("entry_price", { precision: 12, scale: 4 }),
  stop_loss: numeric("stop_loss", { precision: 12, scale: 4 }),
  take_profit: numeric("take_profit", { precision: 12, scale: 4 }),
  session: text("session"),
  regime: text("regime"),
  news_lockout: boolean("news_lockout").notNull().default(false),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertSignalSchema = createInsertSchema(signalsTable).omit({ id: true, created_at: true });
export type InsertSignal = z.infer<typeof insertSignalSchema>;
export type Signal = typeof signalsTable.$inferSelect;
