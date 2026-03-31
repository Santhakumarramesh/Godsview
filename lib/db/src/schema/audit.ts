import { pgTable, serial, text, timestamp, boolean, numeric, integer } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/* ── Audit Events ─────────────────────────────────────────────────── */

export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  event_type: text("event_type").notNull(),
  decision_state: text("decision_state"),
  system_mode: text("system_mode"),
  instrument: text("instrument"),
  setup_type: text("setup_type"),
  symbol: text("symbol"),
  actor: text("actor").notNull().default("system"),
  reason: text("reason"),
  payload_json: text("payload_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertAuditEventSchema = createInsertSchema(auditEventsTable).omit({
  id: true,
  created_at: true,
});
export type InsertAuditEvent = z.infer<typeof insertAuditEventSchema>;
export type AuditEvent = typeof auditEventsTable.$inferSelect;

/* ── Trading Sessions ─────────────────────────────────────────────── */

export const tradingSessionsTable = pgTable("trading_sessions", {
  id: serial("id").primaryKey(),
  session_id: text("session_id").notNull().unique(),
  system_mode: text("system_mode").notNull(),
  operator_id: text("operator_id"),
  started_at: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(),
  ended_at: timestamp("ended_at", { withTimezone: true }),
  trades_executed: integer("trades_executed").default(0),
  signals_generated: integer("signals_generated").default(0),
  realized_pnl: numeric("realized_pnl", { precision: 12, scale: 4 }),
  peak_drawdown_pct: numeric("peak_drawdown_pct", { precision: 8, scale: 4 }),
  breaker_triggered: boolean("breaker_triggered").default(false),
  kill_switch_used: boolean("kill_switch_used").default(false),
  exit_reason: text("exit_reason"),
  notes: text("notes"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertTradingSessionSchema = createInsertSchema(tradingSessionsTable).omit({
  id: true,
  created_at: true,
});
export type InsertTradingSession = z.infer<typeof insertTradingSessionSchema>;
export type TradingSession = typeof tradingSessionsTable.$inferSelect;

/* ── Breaker Events (immutable log of every breaker state change) ── */

export const breakerEventsTable = pgTable("breaker_events", {
  id: serial("id").primaryKey(),
  session_id: text("session_id"),
  level: text("level").notNull(),
  previous_level: text("previous_level"),
  trigger: text("trigger").notNull(),
  daily_pnl: numeric("daily_pnl", { precision: 12, scale: 4 }),
  consecutive_losses: integer("consecutive_losses"),
  position_size_multiplier: numeric("position_size_multiplier", { precision: 5, scale: 4 }),
  details: text("details"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBreakerEventSchema = createInsertSchema(breakerEventsTable).omit({
  id: true,
  created_at: true,
});
export type InsertBreakerEvent = z.infer<typeof insertBreakerEventSchema>;
export type BreakerEvent = typeof breakerEventsTable.$inferSelect;
