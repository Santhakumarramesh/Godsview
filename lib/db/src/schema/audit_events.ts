import { pgTable, serial, text, timestamp } from "drizzle-orm/pg-core";

export const auditEventsTable = pgTable("audit_events", {
  id: serial("id").primaryKey(),
  event_type: text("event_type").notNull(),
  decision_state: text("decision_state"),
  system_mode: text("system_mode"),
  instrument: text("instrument"),
  setup_type: text("setup_type"),
  symbol: text("symbol"),
  actor: text("actor").notNull().default("system"),
  reason: text("reason"),
  payload_json: text("payload_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type AuditEvent = typeof auditEventsTable.$inferSelect;
