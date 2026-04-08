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
 * Strategy Certifications — formal evidence packets proving a strategy
 * has earned a given trust tier through measurable evidence.
 *
 * Lifecycle: initiated → collecting → review → certified | rejected
 */
export const strategyCertificationsTable = pgTable("strategy_certifications", {
  id: serial("id").primaryKey(),
  strategy_id: text("strategy_id").notNull(),
  target_tier: text("target_tier").notNull(),        // paper_approved | live_assisted | autonomous_candidate
  current_tier: text("current_tier"),
  status: text("status").notNull().default("initiated"), // initiated | collecting | review | certified | rejected | expired

  // Evidence gates (each must pass to certify)
  backtest_pass: boolean("backtest_pass"),
  walkforward_pass: boolean("walkforward_pass"),
  stress_test_pass: boolean("stress_test_pass"),
  shadow_pass: boolean("shadow_pass"),
  alignment_pass: boolean("alignment_pass"),
  slippage_pass: boolean("slippage_pass"),
  execution_quality_pass: boolean("execution_quality_pass"),

  // Key metrics at certification time
  backtest_sharpe: numeric("backtest_sharpe", { precision: 8, scale: 4 }),
  backtest_win_rate: numeric("backtest_win_rate", { precision: 6, scale: 4 }),
  live_sharpe: numeric("live_sharpe", { precision: 8, scale: 4 }),
  live_win_rate: numeric("live_win_rate", { precision: 6, scale: 4 }),
  alignment_score: numeric("alignment_score", { precision: 6, scale: 4 }),
  avg_slippage_bps: numeric("avg_slippage_bps", { precision: 8, scale: 2 }),
  paper_trade_count: integer("paper_trade_count"),
  paper_pnl: numeric("paper_pnl", { precision: 14, scale: 4 }),

  // Full evidence packet (all details)
  evidence_json: jsonb("evidence_json"),

  // Approval
  approved_by: text("approved_by"),                   // operator ID or "auto"
  rejection_reason: text("rejection_reason"),
  notes: text("notes"),
  initiated_at: timestamp("initiated_at").notNull().defaultNow(),
  completed_at: timestamp("completed_at"),
  expires_at: timestamp("expires_at"),               // certification validity period
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Zod schemas
export const insertStrategyCertificationSchema = createInsertSchema(strategyCertificationsTable);

// Types
export type StrategyCertification = typeof strategyCertificationsTable.$inferSelect;
export type InsertStrategyCertification = z.infer<typeof insertStrategyCertificationSchema>;
