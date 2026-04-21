import { z } from "zod";

export const WebhookEventSchema = z.object({
  id: z.string(),
  source: z.enum(["pine_alert", "strategy_alert", "manual"]),
  symbol: z.string(),
  action: z.enum(["buy", "sell", "close", "info"]),
  price: z.number().optional(),
  message: z.string().optional(),
  strategyName: z.string().optional(),
  receivedAt: z.string().datetime(),
  processed: z.boolean(),
});
export type WebhookEvent = z.infer<typeof WebhookEventSchema>;

export const PineScriptSchema = z.object({
  id: z.string(),
  name: z.string(),
  version: z.string(),
  code: z.string(),
  signals: z.array(z.string()),
  active: z.boolean(),
  createdAt: z.string().datetime(),
});
export type PineScript = z.infer<typeof PineScriptSchema>;

export const TVActionSchema = z.object({
  id: z.string(),
  type: z.enum(["analyze_symbol", "compare_setups", "save_chart", "launch_backtest", "queue_trade"]),
  symbol: z.string().optional(),
  params: z.record(z.string(), z.unknown()).optional(),
  status: z.enum(["pending", "running", "completed", "failed"]),
  result: z.unknown().optional(),
  createdAt: z.string().datetime(),
});
export type TVAction = z.infer<typeof TVActionSchema>;
