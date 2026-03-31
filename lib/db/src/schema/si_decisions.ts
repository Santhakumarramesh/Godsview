import { pgTable, serial, text, numeric, boolean, timestamp, integer } from "drizzle-orm/pg-core";

/**
 * Super Intelligence decision log — every SI evaluation is persisted
 * for audit trail, model drift detection, and backtest validation.
 */
export const siDecisionsTable = pgTable("si_decisions", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  setup_type: text("setup_type").notNull(),
  direction: text("direction").notNull(),
  regime: text("regime").notNull(),

  // SI output
  approved: boolean("approved").notNull(),
  win_probability: numeric("win_probability", { precision: 5, scale: 4 }).notNull(),
  edge_score: numeric("edge_score", { precision: 6, scale: 4 }).notNull(),
  enhanced_quality: numeric("enhanced_quality", { precision: 5, scale: 4 }).notNull(),
  kelly_fraction: numeric("kelly_fraction", { precision: 5, scale: 4 }).notNull(),
  confluence_score: numeric("confluence_score", { precision: 3, scale: 2 }).notNull(),
  suggested_qty: integer("suggested_qty").notNull(),
  rejection_reason: text("rejection_reason"),
  // Input context
  entry_price: numeric("entry_price", { precision: 12, scale: 4 }).notNull(),
  stop_loss: numeric("stop_loss", { precision: 12, scale: 4 }).notNull(),
  take_profit: numeric("take_profit", { precision: 12, scale: 4 }).notNull(),
  final_quality: numeric("final_quality", { precision: 5, scale: 4 }).notNull(),

  // Production gate
  gate_action: text("gate_action"),
  gate_block_reasons: text("gate_block_reasons"),

  // Trailing stop / profit targets
  trailing_stop_json: text("trailing_stop_json"),
  profit_targets_json: text("profit_targets_json"),

  // Outcome (filled later by reconciliation)
  outcome: text("outcome"),
  realized_pnl: numeric("realized_pnl", { precision: 12, scale: 2 }),

  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type SIDecision = typeof siDecisionsTable.$inferSelect;