import {
  pgTable,
  serial,
  text,
  integer,
  numeric,
  jsonb,
  timestamp,
  index,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

/**
 * Phase 20 — Certification run orchestration tables.
 *
 * `certification_runs` tracks one full strategy certification journey.
 * `certification_run_steps` tracks per-gate execution status and artifacts.
 */
export const certificationRunsTable = pgTable(
  "certification_runs",
  {
    id: serial("id").primaryKey(),
    run_id: text("run_id").notNull().unique(),
    strategy_id: text("strategy_id").notNull(),
    strategy_name: text("strategy_name").notNull(),
    target_tier: text("target_tier").notNull(),
    status: text("status").notNull().default("initiated"),

    config_json: jsonb("config_json")
      .notNull()
      .default(sql`'{}'::jsonb`),
    operator_id: text("operator_id"),

    backtest_started_at: timestamp("backtest_started_at"),
    backtest_completed_at: timestamp("backtest_completed_at"),
    backtest_result_json: jsonb("backtest_result_json"),
    backtest_sharpe: numeric("backtest_sharpe", { precision: 8, scale: 4 }),
    backtest_win_rate: numeric("backtest_win_rate", { precision: 6, scale: 4 }),
    backtest_trade_count: integer("backtest_trade_count"),
    backtest_max_dd: numeric("backtest_max_dd", { precision: 8, scale: 4 }),
    backtest_profit_factor: numeric("backtest_profit_factor", { precision: 8, scale: 4 }),

    wf_started_at: timestamp("wf_started_at"),
    wf_completed_at: timestamp("wf_completed_at"),
    wf_result_json: jsonb("wf_result_json"),
    wf_pass_rate: numeric("wf_pass_rate", { precision: 6, scale: 4 }),
    wf_oos_sharpe: numeric("wf_oos_sharpe", { precision: 8, scale: 4 }),

    stress_started_at: timestamp("stress_started_at"),
    stress_completed_at: timestamp("stress_completed_at"),
    stress_result_json: jsonb("stress_result_json"),
    stress_survival_rate: numeric("stress_survival_rate", { precision: 6, scale: 4 }),
    stress_worst_dd: numeric("stress_worst_dd", { precision: 8, scale: 4 }),

    shadow_started_at: timestamp("shadow_started_at"),
    shadow_completed_at: timestamp("shadow_completed_at"),
    shadow_trade_count: integer("shadow_trade_count").notNull().default(0),
    shadow_win_rate: numeric("shadow_win_rate", { precision: 6, scale: 4 }),
    shadow_pnl: numeric("shadow_pnl", { precision: 14, scale: 4 }),
    shadow_result_json: jsonb("shadow_result_json"),

    alignment_score: numeric("alignment_score", { precision: 6, scale: 4 }),
    avg_slippage_bps: numeric("avg_slippage_bps", { precision: 8, scale: 2 }),
    execution_fill_rate: numeric("execution_fill_rate", { precision: 6, scale: 4 }),
    execution_avg_latency_ms: integer("execution_avg_latency_ms"),

    drift_score: numeric("drift_score", { precision: 6, scale: 4 }),
    drift_status: text("drift_status"),

    evidence_packet_json: jsonb("evidence_packet_json"),
    gate_results_json: jsonb("gate_results_json"),

    governance_verdict: text("governance_verdict"),
    governance_reason: text("governance_reason"),
    approved_by: text("approved_by"),
    rejection_reason: text("rejection_reason"),

    incidents_json: jsonb("incidents_json")
      .notNull()
      .default(sql`'[]'::jsonb`),

    initiated_at: timestamp("initiated_at").notNull().defaultNow(),
    completed_at: timestamp("completed_at"),
    expires_at: timestamp("expires_at"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_cert_runs_strategy").on(table.strategy_id),
    index("idx_cert_runs_status").on(table.status),
    index("idx_cert_runs_run_id").on(table.run_id),
  ],
);

export const certificationRunStepsTable = pgTable(
  "certification_run_steps",
  {
    id: serial("id").primaryKey(),
    run_id: text("run_id")
      .notNull()
      .references(() => certificationRunsTable.run_id, { onDelete: "cascade" }),
    step_name: text("step_name").notNull(),
    step_order: integer("step_order").notNull(),
    status: text("status").notNull().default("pending"),
    started_at: timestamp("started_at"),
    completed_at: timestamp("completed_at"),
    duration_ms: integer("duration_ms"),
    result_json: jsonb("result_json"),
    error_message: text("error_message"),
    created_at: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    index("idx_cert_steps_run").on(table.run_id),
    index("idx_cert_steps_status").on(table.status),
  ],
);

export const insertCertificationRunSchema = createInsertSchema(certificationRunsTable);
export const insertCertificationRunStepSchema = createInsertSchema(certificationRunStepsTable);

export type CertificationRun = typeof certificationRunsTable.$inferSelect;
export type CertificationRunStep = typeof certificationRunStepsTable.$inferSelect;
export type InsertCertificationRun = z.infer<typeof insertCertificationRunSchema>;
export type InsertCertificationRunStep = z.infer<typeof insertCertificationRunStepSchema>;
