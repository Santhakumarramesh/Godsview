import { sql } from "drizzle-orm";
import {
  pgTable,
  serial,
  text,
  numeric,
  integer,
  timestamp,
  jsonb,
  index,
  check,
} from "drizzle-orm/pg-core";

export const executionValidations = pgTable(
  "execution_validations",
  {
    id: serial("id").primaryKey(),
    orderUuid: text("order_uuid").notNull(),
    strategyId: text("strategy_id").notNull(),
    symbol: text("symbol").notNull(),
    side: text("side").notNull(),
    expectedPrice: numeric("expected_price").notNull(),
    actualPrice: numeric("actual_price").notNull(),
    expectedQty: numeric("expected_qty").notNull(),
    actualQty: numeric("actual_qty").notNull(),
    slippageBps: numeric("slippage_bps").notNull(),
    latencyMs: integer("latency_ms").notNull(),
    fillQualityScore: numeric("fill_quality_score", {
      precision: 4,
      scale: 3,
    }).notNull(),
    venue: text("venue").notNull(),
    validatedAt: timestamp("validated_at").notNull().defaultNow(),
    metadata: jsonb("metadata").default({}).notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    strategyIdIdx: index("idx_execution_validations_strategy_id").on(
      table.strategyId
    ),
    symbolIdx: index("idx_execution_validations_symbol").on(table.symbol),
    validatedAtIdx: index("idx_execution_validations_validated_at").on(
      table.validatedAt
    ),
    strategySymbolIdx: index("idx_execution_validations_strategy_symbol").on(
      table.strategyId,
      table.symbol
    ),
    sideCheck: check("side_check", sql`${table.side} IN ('buy', 'sell')`),
    scoreCheck: check(
      "score_check",
      sql`${table.fillQualityScore} >= 0 AND ${table.fillQualityScore} <= 1`
    ),
  })
);

export const slippageDistributions = pgTable(
  "slippage_distributions",
  {
    id: serial("id").primaryKey(),
    strategyId: text("strategy_id").notNull(),
    symbol: text("symbol").notNull(),
    periodStart: timestamp("period_start").notNull(),
    periodEnd: timestamp("period_end").notNull(),
    sampleCount: integer("sample_count").notNull(),
    meanSlippageBps: numeric("mean_slippage_bps").notNull(),
    medianSlippageBps: numeric("median_slippage_bps").notNull(),
    p95SlippageBps: numeric("p95_slippage_bps").notNull(),
    p99SlippageBps: numeric("p99_slippage_bps").notNull(),
    stdDevBps: numeric("std_dev_bps").notNull(),
    favorablePct: numeric("favorable_pct").notNull(),
    computedAt: timestamp("computed_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    strategyIdIdx: index("idx_slippage_distributions_strategy_id").on(
      table.strategyId
    ),
    symbolIdx: index("idx_slippage_distributions_symbol").on(table.symbol),
    periodIdx: index("idx_slippage_distributions_period").on(
      table.periodStart,
      table.periodEnd
    ),
    strategySymbolIdx: index("idx_slippage_distributions_strategy_symbol").on(
      table.strategyId,
      table.symbol
    ),
    favorablePctCheck: check(
      "favorable_pct_check",
      sql`${table.favorablePct} >= 0 AND ${table.favorablePct} <= 100`
    ),
  })
);

export const executionDriftEvents = pgTable(
  "execution_drift_events",
  {
    id: serial("id").primaryKey(),
    strategyId: text("strategy_id").notNull(),
    driftType: text("drift_type").notNull(),
    severity: text("severity").notNull(),
    observedValue: numeric("observed_value").notNull(),
    expectedRangeLow: numeric("expected_range_low").notNull(),
    expectedRangeHigh: numeric("expected_range_high").notNull(),
    details: jsonb("details").default({}).notNull(),
    detectedAt: timestamp("detected_at").notNull().defaultNow(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => ({
    strategyIdIdx: index("idx_execution_drift_events_strategy_id").on(
      table.strategyId
    ),
    driftTypeIdx: index("idx_execution_drift_events_drift_type").on(
      table.driftType
    ),
    severityIdx: index("idx_execution_drift_events_severity").on(
      table.severity
    ),
    detectedAtIdx: index("idx_execution_drift_events_detected_at").on(
      table.detectedAt
    ),
    strategyDetectedIdx: index("idx_execution_drift_events_strategy_detected").on(
      table.strategyId,
      table.detectedAt
    ),
    driftTypeCheck: check(
      "drift_type_check",
      sql`${table.driftType} IN ('slippage_spike', 'latency_spike', 'fill_rate_drop', 'venue_degradation')`
    ),
    severityCheck: check(
      "severity_check",
      sql`${table.severity} IN ('info', 'warning', 'critical')`
    ),
  })
);

export type ExecutionValidation = typeof executionValidations.$inferSelect;
export type ExecutionValidationInsert = typeof executionValidations.$inferInsert;
export type SlippageDistribution = typeof slippageDistributions.$inferSelect;
export type SlippageDistributionInsert = typeof slippageDistributions.$inferInsert;
export type ExecutionDriftEvent = typeof executionDriftEvents.$inferSelect;
export type ExecutionDriftEventInsert = typeof executionDriftEvents.$inferInsert;
