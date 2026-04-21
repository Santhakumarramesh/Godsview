import { z } from "zod";

export const ExecutionModeSchema = z.enum(["paper", "assisted", "semi_auto", "autonomous"]);
export type ExecutionMode = z.infer<typeof ExecutionModeSchema>;

export const OrderSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["buy", "sell"]),
  type: z.enum(["market", "limit", "stop", "stop_limit"]),
  quantity: z.number(),
  price: z.number().optional(),
  stopPrice: z.number().optional(),
  status: z.enum(["pending_approval", "submitted", "partial_fill", "filled", "cancelled", "rejected"]),
  executionMode: ExecutionModeSchema,
  strategyId: z.string().optional(),
  filledQty: z.number().default(0),
  avgFillPrice: z.number().optional(),
  slippage: z.number().optional(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Order = z.infer<typeof OrderSchema>;

export const PositionSchema = z.object({
  id: z.string(),
  symbol: z.string(),
  side: z.enum(["long", "short"]),
  quantity: z.number(),
  entryPrice: z.number(),
  currentPrice: z.number(),
  unrealizedPnl: z.number(),
  realizedPnl: z.number(),
  stopLoss: z.number().optional(),
  takeProfit: z.number().optional(),
  strategyId: z.string().optional(),
  openedAt: z.string().datetime(),
});
export type Position = z.infer<typeof PositionSchema>;

export const FillSchema = z.object({
  id: z.string(),
  orderId: z.string(),
  price: z.number(),
  quantity: z.number(),
  side: z.enum(["buy", "sell"]),
  timestamp: z.string().datetime(),
  fee: z.number(),
});
export type Fill = z.infer<typeof FillSchema>;
