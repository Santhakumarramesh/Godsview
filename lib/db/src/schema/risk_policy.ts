import { pgTable, serial, text, numeric, timestamp, boolean, integer } from "drizzle-orm/pg-core";

export const riskPolicyTable = pgTable("risk_policy", {
  id: serial("id").primaryKey(),
  org_id: text("org_id").notNull().default("org_default"),
  active: boolean("active").notNull().default(false),
  max_signal_age_sec: integer("max_signal_age_sec").notNull().default(300),
  min_rr: numeric("min_rr", { precision: 4, scale: 2 }).notNull().default("1.00"),
  max_exposure_usd: numeric("max_exposure_usd", { precision: 12, scale: 2 }).notNull().default("50000.00"),
  dollar_risk: numeric("dollar_risk", { precision: 10, scale: 2 }).notNull().default("100.00"),
  daily_loss_cap: numeric("daily_loss_cap", { precision: 12, scale: 2 }).notNull().default("500.00"),
  max_daily_trades: integer("max_daily_trades").notNull().default(10),
  max_open_positions: integer("max_open_positions").notNull().default(5),
  set_by: text("set_by").notNull().default("system"),
  reason: text("reason"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type RiskPolicy = typeof riskPolicyTable.$inferSelect;
