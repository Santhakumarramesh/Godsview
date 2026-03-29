import {
  pgTable,
  serial,
  text,
  numeric,
  timestamp,
  integer,
} from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod/v4";

export const brainEntitiesTable = pgTable("brain_entities", {
  id: serial("id").primaryKey(),
  symbol: text("symbol").notNull(),
  entity_type: text("entity_type").notNull().default("stock"),
  name: text("name"),
  sector: text("sector"),
  regime: text("regime"),
  volatility: numeric("volatility", { precision: 8, scale: 4 }),
  last_price: numeric("last_price", { precision: 14, scale: 6 }),
  state_json: text("state_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updated_at: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brainRelationsTable = pgTable("brain_relations", {
  id: serial("id").primaryKey(),
  source_entity_id: integer("source_entity_id").notNull(),
  target_entity_id: integer("target_entity_id").notNull(),
  relation_type: text("relation_type").notNull(),
  strength: numeric("strength", { precision: 6, scale: 4 }).notNull().default("0.5000"),
  context_json: text("context_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const brainMemoriesTable = pgTable("brain_memories", {
  id: serial("id").primaryKey(),
  entity_id: integer("entity_id").notNull(),
  memory_type: text("memory_type").notNull(),
  title: text("title").notNull(),
  content: text("content").notNull(),
  signal_id: integer("signal_id"),
  trade_id: integer("trade_id"),
  confidence: numeric("confidence", { precision: 6, scale: 4 }).notNull().default("0.5000"),
  outcome_score: numeric("outcome_score", { precision: 8, scale: 4 }),
  tags: text("tags"),
  context_json: text("context_json"),
  created_at: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const insertBrainEntitySchema = createInsertSchema(brainEntitiesTable).omit({
  id: true,
  created_at: true,
  updated_at: true,
});
export const insertBrainRelationSchema = createInsertSchema(brainRelationsTable).omit({
  id: true,
  created_at: true,
});
export const insertBrainMemorySchema = createInsertSchema(brainMemoriesTable).omit({
  id: true,
  created_at: true,
});

export type InsertBrainEntity = z.infer<typeof insertBrainEntitySchema>;
export type InsertBrainRelation = z.infer<typeof insertBrainRelationSchema>;
export type InsertBrainMemory = z.infer<typeof insertBrainMemorySchema>;

export type BrainEntity = typeof brainEntitiesTable.$inferSelect;
export type BrainRelation = typeof brainRelationsTable.$inferSelect;
export type BrainMemory = typeof brainMemoriesTable.$inferSelect;

