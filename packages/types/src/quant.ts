import { z } from "zod";

export const BacktestConfigSchema = z.object({
  strategyId: z.string(),
  symbols: z.array(z.string()),
  startDate: z.string(),
  endDate: z.string(),
  timeframe: z.string(),
  initialCapital: z.number(),
  commission: z.number().default(0),
  slippage: z.number().default(0),
});
export type BacktestConfig = z.infer<typeof BacktestConfigSchema>;

export const BacktestResultSchema = z.object({
  id: z.string(),
  config: BacktestConfigSchema,
  totalTrades: z.number(),
  winRate: z.number(),
  profitFactor: z.number(),
  sharpeRatio: z.number(),
  maxDrawdown: z.number(),
  expectancy: z.number(),
  netPnl: z.number(),
  avgHoldTime: z.string(),
  trades: z.array(z.object({
    symbol: z.string(),
    side: z.enum(["long", "short"]),
    entry: z.number(),
    exit: z.number(),
    pnl: z.number(),
    entryTime: z.string(),
    exitTime: z.string(),
  })),
  completedAt: z.string().datetime(),
});
export type BacktestResult = z.infer<typeof BacktestResultSchema>;

export const ExperimentSchema = z.object({
  id: z.string(),
  name: z.string(),
  strategyId: z.string(),
  parameters: z.record(z.string(), z.unknown()),
  results: z.array(z.string()),
  bestResultId: z.string().optional(),
  status: z.enum(["running", "completed", "failed"]),
  createdAt: z.string().datetime(),
});
export type Experiment = z.infer<typeof ExperimentSchema>;

export const PromotionSchema = z.object({
  id: z.string(),
  strategyId: z.string(),
  fromStage: z.enum(["research", "paper", "assisted", "semi_auto", "autonomous"]),
  toStage: z.enum(["research", "paper", "assisted", "semi_auto", "autonomous"]),
  gatingChecks: z.array(z.object({
    name: z.string(),
    passed: z.boolean(),
    value: z.number().optional(),
    threshold: z.number().optional(),
  })),
  approved: z.boolean(),
  approvedBy: z.string().optional(),
  createdAt: z.string().datetime(),
});
export type Promotion = z.infer<typeof PromotionSchema>;
