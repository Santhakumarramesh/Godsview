import { z } from "zod";

export const RecallEntrySchema = z.object({
  id: z.string(),
  symbol: z.string(),
  setupType: z.string(),
  timeframe: z.string(),
  outcome: z.enum(["win", "loss", "breakeven", "pending"]),
  pnl: z.number().optional(),
  confluenceFactors: z.array(z.string()),
  screenshotUrl: z.string().optional(),
  notes: z.string().optional(),
  similarity: z.number().optional(),
  createdAt: z.string().datetime(),
});
export type RecallEntry = z.infer<typeof RecallEntrySchema>;

export const JournalEntrySchema = z.object({
  id: z.string(),
  tradeId: z.string().optional(),
  symbol: z.string(),
  summary: z.string(),
  mistakes: z.array(z.string()),
  lessons: z.array(z.string()),
  emotionalState: z.enum(["calm", "anxious", "confident", "frustrated", "neutral"]).optional(),
  rating: z.number().min(1).max(5).optional(),
  createdAt: z.string().datetime(),
});
export type JournalEntry = z.infer<typeof JournalEntrySchema>;

export const CaseSchema = z.object({
  id: z.string(),
  title: z.string(),
  category: z.enum(["best_trade", "worst_trade", "edge_case", "anomaly", "learning"]),
  entries: z.array(z.string()),
  tags: z.array(z.string()),
  createdAt: z.string().datetime(),
});
export type Case = z.infer<typeof CaseSchema>;
