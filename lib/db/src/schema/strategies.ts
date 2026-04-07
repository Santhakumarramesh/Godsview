/**
 * Strategy Lifecycle Schema — Persistent storage for strategy governance.
 * Replaces JSON file persistence for strategies, promotions, evidence packets.
 */
import { pgTable, text, timestamp, jsonb, real, integer, boolean, uuid } from "drizzle-orm/pg-core";

// ── Strategy Registry ─────────────────────────────────────────────────
export const strategies = pgTable("strategies", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: text("name").notNull(),
  description: text("description"),
  dslPayload: jsonb("dsl_payload"),                   // Full strategy DSL
  rawInput: text("raw_input"),                         // Original NL input
  status: text("status").notNull().default("draft"),   // draft|parsed|backtested|stress_tested|shadow_ready|paper_approved|live_assisted|autonomous|degraded|paused|retired|rolled_back
  version: integer("version").notNull().default(1),
  parentId: uuid("parent_id"),                         // For versioning lineage
  createdBy: text("created_by").default("system"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

// ── Promotion Events ──────────────────────────────────────────────────
export const promotionEvents = pgTable("promotion_events", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyId: uuid("strategy_id").notNull(),
  fromStatus: text("from_status").notNull(),
  toStatus: text("to_status").notNull(),
  approvedBy: text("approved_by").notNull(),           // operator|system|auto
  evidencePacket: jsonb("evidence_packet"),             // Full evidence snapshot
  reason: text("reason"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Strategy Evidence Packets ─────────────────────────────────────────
export const evidencePackets = pgTable("evidence_packets", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyId: uuid("strategy_id").notNull(),
  backtestSharpe: real("backtest_sharpe"),
  backtestWinRate: real("backtest_win_rate"),
  backtestMaxDrawdown: real("backtest_max_drawdown"),
  backtestSampleSize: integer("backtest_sample_size"),
  walkForwardOosSharpe: real("walk_forward_oos_sharpe"),
  walkForwardOosWinRate: real("walk_forward_oos_win_rate"),
  walkForwardDegradation: real("walk_forward_degradation"),
  shadowWinRate: real("shadow_win_rate"),
  shadowSampleSize: integer("shadow_sample_size"),
  paperWinRate: real("paper_win_rate"),
  paperSampleSize: integer("paper_sample_size"),
  paperDurationDays: integer("paper_duration_days"),
  calibrationDrift: real("calibration_drift"),
  replayGrade: text("replay_grade"),                   // A-F
  riskLimitsPass: boolean("risk_limits_pass"),
  operatorApproved: boolean("operator_approved").default(false),
  fullPayload: jsonb("full_payload"),                   // Complete evidence blob
  createdAt: timestamp("created_at").defaultNow().notNull(),
});

// ── Calibration History ───────────────────────────────────────────────
export const calibrationHistory = pgTable("calibration_history", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyId: uuid("strategy_id").notNull(),
  symbol: text("symbol"),
  backtestWinRate: real("backtest_win_rate").notNull(),
  liveWinRate: real("live_win_rate").notNull(),
  drift: real("drift").notNull(),                       // liveWinRate - backtestWinRate
  driftSeverity: text("drift_severity"),                // normal|warning|critical
  sampleSize: integer("sample_size").notNull(),
  measuredAt: timestamp("measured_at").defaultNow().notNull(),
});

// ── Trade Outcomes ────────────────────────────────────────────────────
export const tradeOutcomes = pgTable("trade_outcomes", {
  id: uuid("id").defaultRandom().primaryKey(),
  strategyId: uuid("strategy_id"),
  symbol: text("symbol").notNull(),
  side: text("side").notNull(),                         // buy|sell
  entryPrice: real("entry_price").notNull(),
  exitPrice: real("exit_price"),
  quantity: real("quantity").notNull(),
  pnl: real("pnl"),
  pnlPercent: real("pnl_percent"),
  slippage: real("slippage"),
  commissions: real("commissions"),
  holdingPeriodMs: integer("holding_period_ms"),
  executionMode: text("execution_mode").notNull(),      // paper|live
  exitReason: text("exit_reason"),                      // target|stop|trailing|timeout|manual
  enteredAt: timestamp("entered_at").notNull(),
  exitedAt: timestamp("exited_at"),
  metadata: jsonb("metadata"),
});

// ── Kill Switch Log ───────────────────────────────────────────────────
export const killSwitchLog = pgTable("kill_switch_log", {
  id: uuid("id").defaultRandom().primaryKey(),
  action: text("action").notNull(),                     // activate|deactivate
  reason: text("reason").notNull(),
  actor: text("actor").notNull(),
  mode: text("mode"),                                   // paper|live
  createdAt: timestamp("created_at").defaultNow().notNull(),
});
