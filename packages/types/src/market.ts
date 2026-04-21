import { z } from "zod";

export const MarketRegimeSchema = z.enum(["trending_up", "trending_down", "ranging", "volatile", "illiquid", "news_driven"]);
export type MarketRegime = z.infer<typeof MarketRegimeSchema>;

export const ScanCandidateSchema = z.object({
  symbol: z.string(),
  confluenceScore: z.number().min(0).max(100),
  regime: MarketRegimeSchema,
  direction: z.enum(["long", "short", "neutral"]),
  volatility: z.number(),
  liquidity: z.number(),
  signals: z.array(z.string()),
  timestamp: z.string().datetime(),
});
export type ScanCandidate = z.infer<typeof ScanCandidateSchema>;

export const WatchlistSchema = z.object({
  id: z.string(),
  name: z.string(),
  symbols: z.array(z.string()),
  priority: z.enum(["high", "medium", "low"]),
  createdAt: z.string().datetime(),
});
export type Watchlist = z.infer<typeof WatchlistSchema>;

export const OpportunitySchema = z.object({
  id: z.string(),
  symbol: z.string(),
  setupType: z.string(),
  status: z.enum(["new", "validated", "pending", "approved", "rejected"]),
  confluenceScore: z.number(),
  entry: z.number().optional(),
  stop: z.number().optional(),
  target: z.number().optional(),
  riskReward: z.number().optional(),
  createdAt: z.string().datetime(),
});
export type Opportunity = z.infer<typeof OpportunitySchema>;
