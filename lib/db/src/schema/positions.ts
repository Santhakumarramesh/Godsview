import { pgTable, uuid, text, timestamp, doublePrecision, pgEnum } from "drizzle-orm/pg-core";

export const positionSideEnum = pgEnum("position_side", ["long", "short"]);

export const positionsTable = pgTable("positions", {
  position_id: uuid("position_id").primaryKey().defaultRandom(),
  symbol: text("symbol").notNull(),
  side: positionSideEnum("side").notNull(),
  quantity: doublePrecision("quantity").notNull(),
  entry_price: doublePrecision("entry_price").notNull(),
  current_price: doublePrecision("current_price").notNull(),
  unrealized_pnl: doublePrecision("unrealized_pnl").notNull().default(0),
  realized_pnl: doublePrecision("realized_pnl").notNull().default(0),
  stop_loss: doublePrecision("stop_loss"),
  take_profit: doublePrecision("take_profit"),
  opened_at: timestamp("opened_at", { withTimezone: true }).notNull().defaultNow(),
  closed_at: timestamp("closed_at", { withTimezone: true }),
});

export type Position = typeof positionsTable.$inferSelect;
export type NewPosition = typeof positionsTable.$inferInsert;
