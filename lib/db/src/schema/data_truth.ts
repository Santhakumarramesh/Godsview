import {
  pgTable,
  serial,
  varchar,
  real,
  integer,
  timestamp,
  jsonb,
  index,
  check,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';

export const dataQualityScores = pgTable(
  'data_quality_scores',
  {
    id: serial('id').primaryKey(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    timeframe: varchar('timeframe', { length: 10 }).notNull(),
    source: varchar('source', { length: 20 }).notNull(), // 'backtest' | 'paper' | 'live'
    qualityScore: real('quality_score').notNull(),
    freshnessScore: real('freshness_score').notNull(),
    completenessScore: real('completeness_score').notNull(),
    consistencyScore: real('consistency_score').notNull(),
    gapCount: integer('gap_count').notNull().default(0),
    staleBarCount: integer('stale_bar_count').notNull().default(0),
    totalBars: integer('total_bars').notNull().default(0),
    scoredAt: timestamp('scored_at', { withTimezone: true }).notNull().defaultNow(),
    metadata: jsonb('metadata'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_data_quality_scores_symbol_timeframe').on(table.symbol, table.timeframe),
    index('idx_data_quality_scores_source').on(table.source),
    index('idx_data_quality_scores_scored_at').on(table.scoredAt),
    index('idx_data_quality_scores_quality_score').on(table.qualityScore),
    check('quality_score_range', sql`quality_score >= 0 AND quality_score <= 1`),
    check('freshness_score_range', sql`freshness_score >= 0 AND freshness_score <= 1`),
    check('completeness_score_range', sql`completeness_score >= 0 AND completeness_score <= 1`),
    check('consistency_score_range', sql`consistency_score >= 0 AND consistency_score <= 1`),
  ]
);

export const dataFeedHealth = pgTable(
  'data_feed_health',
  {
    id: serial('id').primaryKey(),
    feedName: varchar('feed_name', { length: 50 }).notNull().unique(),
    status: varchar('status', { length: 20 }).notNull(), // 'healthy' | 'degraded' | 'stale' | 'dead'
    lastTickAt: timestamp('last_tick_at', { withTimezone: true }),
    avgLatencyMs: real('avg_latency_ms').notNull().default(0),
    gapEvents24h: integer('gap_events_24h').notNull().default(0),
    uptime24hPct: real('uptime_pct_24h').notNull().default(100),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    details: jsonb('details'),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_data_feed_health_status').on(table.status),
    index('idx_data_feed_health_checked_at').on(table.checkedAt),
    index('idx_data_feed_health_feed_name').on(table.feedName),
    check('uptime_range', sql`uptime_pct_24h >= 0 AND uptime_pct_24h <= 100`),
  ]
);

export const dataConsistencyChecks = pgTable(
  'data_consistency_checks',
  {
    id: serial('id').primaryKey(),
    symbol: varchar('symbol', { length: 20 }).notNull(),
    timeframe: varchar('timeframe', { length: 10 }).notNull(),
    checkType: varchar('check_type', { length: 30 }).notNull(), // 'cross_source' | 'temporal' | 'schema'
    sourceA: varchar('source_a', { length: 20 }),
    sourceB: varchar('source_b', { length: 20 }),
    divergenceScore: real('divergence_score').notNull(),
    divergenceDetails: jsonb('divergence_details'),
    checkedAt: timestamp('checked_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    index('idx_data_consistency_checks_symbol_timeframe').on(table.symbol, table.timeframe),
    index('idx_data_consistency_checks_check_type').on(table.checkType),
    index('idx_data_consistency_checks_checked_at').on(table.checkedAt),
    index('idx_data_consistency_checks_divergence_score').on(table.divergenceScore),
    index('idx_data_consistency_checks_sources').on(table.sourceA, table.sourceB),
    check('divergence_score_range', sql`divergence_score >= 0 AND divergence_score <= 1`),
  ]
);

export type DataQualityScore = typeof dataQualityScores.$inferSelect;
export type NewDataQualityScore = typeof dataQualityScores.$inferInsert;

export type DataFeedHealth = typeof dataFeedHealth.$inferSelect;
export type NewDataFeedHealth = typeof dataFeedHealth.$inferInsert;

export type DataConsistencyCheck = typeof dataConsistencyChecks.$inferSelect;
export type NewDataConsistencyCheck = typeof dataConsistencyChecks.$inferInsert;
