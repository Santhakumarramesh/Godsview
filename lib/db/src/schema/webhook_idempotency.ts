import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const webhookIdempotencyTable = pgTable("webhook_idempotency", {
  id: serial("id").primaryKey(),
  key: text("key").unique().notNull(),
  source: text("source").notNull().default("tradingview"),
  payload_hash: text("payload_hash"),
  envelope_json: text("envelope_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type WebhookIdempotency = typeof webhookIdempotencyTable.$inferSelect;
