import { pgTable, uuid, timestamp, doublePrecision, boolean, text } from "drizzle-orm/pg-core";

export const riskAssessmentsTable = pgTable("risk_assessments", {
  assessment_id: uuid("assessment_id").primaryKey().defaultRandom(),
  portfolio_var_95: doublePrecision("portfolio_var_95").notNull(),
  portfolio_var_99: doublePrecision("portfolio_var_99").notNull(),
  max_drawdown: doublePrecision("max_drawdown").notNull(),
  current_drawdown: doublePrecision("current_drawdown").notNull(),
  exposure_pct: doublePrecision("exposure_pct").notNull(),
  margin_used_pct: doublePrecision("margin_used_pct").notNull(),
  risk_score: doublePrecision("risk_score").notNull(),
  circuit_breaker_active: boolean("circuit_breaker_active").notNull().default(false),
  warnings: text("warnings").array(),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RiskAssessment = typeof riskAssessmentsTable.$inferSelect;
export type NewRiskAssessment = typeof riskAssessmentsTable.$inferInsert;
