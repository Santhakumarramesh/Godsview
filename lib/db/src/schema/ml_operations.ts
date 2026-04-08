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
 * Model Versions — tracks every trained model version with metrics,
 * config, and promotion status.
 */
export const modelVersionsTable = pgTable("model_versions", {
  id: serial("id").primaryKey(),
  model_name: text("model_name").notNull(),         // e.g. "win_probability_global", "win_probability_SPY_sweep"
  version: integer("version").notNull(),
  status: text("status").notNull().default("trained"), // trained | shadow | champion | retired | rolled_back
  // Training context
  training_rows: integer("training_rows"),
  feature_count: integer("feature_count"),
  feature_names_json: jsonb("feature_names_json"),     // string[]
  config_json: jsonb("config_json"),                   // hyperparams, thresholds

  // Metrics at training time
  accuracy: numeric("accuracy", { precision: 6, scale: 4 }),
  auc_roc: numeric("auc_roc", { precision: 6, scale: 4 }),
  f1_score: numeric("f1_score", { precision: 6, scale: 4 }),
  brier_score: numeric("brier_score", { precision: 8, scale: 6 }),
  log_loss: numeric("log_loss", { precision: 8, scale: 6 }),
  precision_score: numeric("precision_score", { precision: 6, scale: 4 }),
  recall_score: numeric("recall_score", { precision: 6, scale: 4 }),

  // Live performance (updated post-deployment)
  live_accuracy: numeric("live_accuracy", { precision: 6, scale: 4 }),
  live_brier_score: numeric("live_brier_score", { precision: 8, scale: 6 }),
  live_trade_count: integer("live_trade_count").default(0),
  live_win_rate: numeric("live_win_rate", { precision: 6, scale: 4 }),

  // Promotion tracking
  promoted_at: timestamp("promoted_at"),
  retired_at: timestamp("retired_at"),
  promoted_from_version: integer("promoted_from_version"),
  promotion_reason: text("promotion_reason"),
  // Storage
  model_artifact_path: text("model_artifact_path"),   // path to serialized model
  training_data_hash: text("training_data_hash"),      // reproducibility

  created_at: timestamp("created_at").notNull().defaultNow(),
});

/**
 * Feature Definitions — centralized feature catalog.
 * Each feature has a name, type, computation source, and freshness requirement.
 */
export const featureDefinitionsTable = pgTable("feature_definitions", {
  id: serial("id").primaryKey(),
  feature_name: text("feature_name").notNull(),
  feature_type: text("feature_type").notNull(),       // numeric | categorical | boolean
  computation_source: text("computation_source"),      // e.g. "structure_score", "regime_onehot", "vol_ratio"
  description: text("description"),
  is_active: boolean("is_active").default(true),
  importance_rank: integer("importance_rank"),          // from model's feature importance
  avg_importance: numeric("avg_importance", { precision: 8, scale: 6 }),
  staleness_threshold_ms: integer("staleness_threshold_ms"), // max age before considered stale
  created_at: timestamp("created_at").notNull().defaultNow(),
  updated_at: timestamp("updated_at").notNull().defaultNow(),
});
/**
 * Model Evaluations — periodic evaluation of champion vs challenger.
 * Used for promotion decisions.
 */
export const modelEvaluationsTable = pgTable("model_evaluations", {
  id: serial("id").primaryKey(),
  champion_version_id: integer("champion_version_id").notNull(),
  challenger_version_id: integer("challenger_version_id"),
  evaluation_type: text("evaluation_type").notNull(),   // shadow_comparison | periodic_review | drift_triggered

  // Champion metrics (current period)
  champion_accuracy: numeric("champion_accuracy", { precision: 6, scale: 4 }),
  champion_brier: numeric("champion_brier", { precision: 8, scale: 6 }),
  champion_trade_count: integer("champion_trade_count"),
  champion_win_rate: numeric("champion_win_rate", { precision: 6, scale: 4 }),

  // Challenger metrics (if shadow comparison)
  challenger_accuracy: numeric("challenger_accuracy", { precision: 6, scale: 4 }),
  challenger_brier: numeric("challenger_brier", { precision: 8, scale: 6 }),
  challenger_trade_count: integer("challenger_trade_count"),
  challenger_win_rate: numeric("challenger_win_rate", { precision: 6, scale: 4 }),

  // Verdict
  verdict: text("verdict").notNull(),                   // champion_holds | challenger_wins | insufficient_data | draw
  improvement_pct: numeric("improvement_pct", { precision: 8, scale: 4 }),
  action_taken: text("action_taken"),                   // none | promote_challenger | retrain | retire_champion
  notes: text("notes"),

  created_at: timestamp("created_at").notNull().defaultNow(),
});
/**
 * Retrain Events — logs every retrain attempt with outcome.
 */
export const retrainEventsTable = pgTable("retrain_events", {
  id: serial("id").primaryKey(),
  model_name: text("model_name").notNull(),
  trigger: text("trigger").notNull(),                  // scheduled | drift_detected | manual | data_threshold
  status: text("status").notNull(),                    // started | completed | failed

  // Input context
  training_rows: integer("training_rows"),
  new_rows_since_last: integer("new_rows_since_last"),
  data_hash: text("data_hash"),

  // Output
  new_version_id: integer("new_version_id"),
  accuracy_before: numeric("accuracy_before", { precision: 6, scale: 4 }),
  accuracy_after: numeric("accuracy_after", { precision: 6, scale: 4 }),
  improvement: numeric("improvement", { precision: 8, scale: 4 }),

  duration_ms: integer("duration_ms"),
  error_message: text("error_message"),
  created_at: timestamp("created_at").notNull().defaultNow(),
});

// Zod schemas
export const insertModelVersionSchema = createInsertSchema(modelVersionsTable);
export const insertFeatureDefinitionSchema = createInsertSchema(featureDefinitionsTable);
export const insertModelEvaluationSchema = createInsertSchema(modelEvaluationsTable);
export const insertRetrainEventSchema = createInsertSchema(retrainEventsTable);
// Types
export type ModelVersion = typeof modelVersionsTable.$inferSelect;
export type InsertModelVersion = z.infer<typeof insertModelVersionSchema>;
export type FeatureDefinition = typeof featureDefinitionsTable.$inferSelect;
export type ModelEvaluation = typeof modelEvaluationsTable.$inferSelect;
export type RetrainEvent = typeof retrainEventsTable.$inferSelect;
