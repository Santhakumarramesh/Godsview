import { z } from "zod";

export const PortfolioSnapshotSchema = z.object({
  totalEquity: z.number(),
  cashAvailable: z.number(),
  totalExposure: z.number(),
  unrealizedPnl: z.number(),
  realizedPnlToday: z.number(),
  drawdownPct: z.number(),
  positionCount: z.number(),
  timestamp: z.string().datetime(),
});
export type PortfolioSnapshot = z.infer<typeof PortfolioSnapshotSchema>;

export const RiskPolicySchema = z.object({
  id: z.string(),
  name: z.string(),
  type: z.enum(["max_loss_daily", "max_loss_weekly", "max_positions", "max_exposure", "max_position_size", "min_rr", "correlation_limit"]),
  threshold: z.number(),
  action: z.enum(["warn", "block", "flatten"]),
  active: z.boolean(),
});
export type RiskPolicy = z.infer<typeof RiskPolicySchema>;

export const PreTradeCheckSchema = z.object({
  orderId: z.string(),
  checks: z.array(z.object({
    rule: z.string(),
    passed: z.boolean(),
    reason: z.string().optional(),
  })),
  overallPass: z.boolean(),
  timestamp: z.string().datetime(),
});
export type PreTradeCheck = z.infer<typeof PreTradeCheckSchema>;

export const AllocationSchema = z.object({
  strategyId: z.string(),
  targetPct: z.number(),
  actualPct: z.number(),
  capitalAllocated: z.number(),
  maxDrawdown: z.number(),
});
export type Allocation = z.infer<typeof AllocationSchema>;
