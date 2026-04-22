/**
 * ── Shared Data Contracts ──────────────────────────────────────────────────
 * Canonical Zod schemas for Python ↔ Node communication.
 * Each schema here has a matching Pydantic model in python/shared_contracts.py
 *
 * RULE: Any change here MUST be mirrored in the Pydantic counterpart.
 */
import { z } from "zod";

/* ── Signal Contract ────────────────────────────────────────────────────────── */
export const SignalContract = z.object({
  signal_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  symbol: z.string().min(1),
  direction: z.enum(["long", "short", "flat"]),
  confidence: z.number().min(0).max(1),
  setup_type: z.string(),
  timeframe: z.string(),
  entry_price: z.number().positive(),
  stop_loss: z.number().positive(),
  take_profit: z.number().positive(),
  risk_reward: z.number().positive(),
  source_layer: z.enum(["smc", "ml", "sentiment", "regime", "composite", "manual"]),
  metadata: z.record(z.unknown()).optional(),
});
export type Signal = z.infer<typeof SignalContract>;

/* ── Order Contract ─────────────────────────────────────────────────────────── */
export const OrderContract = z.object({
  order_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  symbol: z.string().min(1),
  side: z.enum(["buy", "sell"]),
  order_type: z.enum(["market", "limit", "stop", "stop_limit"]),
  quantity: z.number().positive(),
  price: z.number().positive().optional(),
  stop_price: z.number().positive().optional(),
  time_in_force: z.enum(["day", "gtc", "ioc", "fok"]),
  status: z.enum(["pending", "submitted", "partial", "filled", "cancelled", "rejected"]),
  filled_qty: z.number().min(0).default(0),
  avg_fill_price: z.number().optional(),
  signal_id: z.string().uuid().optional(),
  broker: z.string().default("alpaca"),
});
export type Order = z.infer<typeof OrderContract>;

/* ── Position Contract ──────────────────────────────────────────────────────── */
export const PositionContract = z.object({
  position_id: z.string().uuid(),
  symbol: z.string().min(1),
  side: z.enum(["long", "short"]),
  quantity: z.number().positive(),
  entry_price: z.number().positive(),
  current_price: z.number().positive(),
  unrealized_pnl: z.number(),
  realized_pnl: z.number(),
  opened_at: z.string().datetime(),
  closed_at: z.string().datetime().optional(),
  stop_loss: z.number().positive().optional(),
  take_profit: z.number().positive().optional(),
});
export type Position = z.infer<typeof PositionContract>;

/* ── Risk Assessment Contract ───────────────────────────────────────────────── */
export const RiskAssessmentContract = z.object({
  assessment_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  portfolio_var_95: z.number(),
  portfolio_var_99: z.number(),
  max_drawdown: z.number(),
  current_drawdown: z.number(),
  exposure_pct: z.number().min(0).max(100),
  margin_used_pct: z.number().min(0).max(100),
  risk_score: z.number().min(0).max(100),
  circuit_breaker_active: z.boolean(),
  warnings: z.array(z.string()),
});
export type RiskAssessment = z.infer<typeof RiskAssessmentContract>;

/* ── Market Data Tick Contract ──────────────────────────────────────────────── */
export const MarketTickContract = z.object({
  symbol: z.string().min(1),
  timestamp: z.string().datetime(),
  bid: z.number().positive(),
  ask: z.number().positive(),
  last: z.number().positive(),
  volume: z.number().min(0),
  vwap: z.number().positive().optional(),
});
export type MarketTick = z.infer<typeof MarketTickContract>;

/* ── OHLCV Bar Contract ─────────────────────────────────────────────────────── */
export const OHLCVBarContract = z.object({
  symbol: z.string().min(1),
  timeframe: z.string(),
  timestamp: z.string().datetime(),
  open: z.number().positive(),
  high: z.number().positive(),
  low: z.number().positive(),
  close: z.number().positive(),
  volume: z.number().min(0),
});
export type OHLCVBar = z.infer<typeof OHLCVBarContract>;

/* ── Brain Event Contract ───────────────────────────────────────────────────── */
export const BrainEventContract = z.object({
  event_id: z.string().uuid(),
  timestamp: z.string().datetime(),
  subsystem: z.string(),
  event_type: z.enum(["signal", "decision", "execution", "risk", "alert", "status", "heartbeat"]),
  severity: z.enum(["info", "warning", "error", "critical"]),
  payload: z.record(z.unknown()),
  correlation_id: z.string().uuid().optional(),
});
export type BrainEvent = z.infer<typeof BrainEventContract>;

/* ── Strategy Performance Contract ──────────────────────────────────────────── */
export const StrategyPerformanceContract = z.object({
  strategy_id: z.string(),
  strategy_name: z.string(),
  period_start: z.string().datetime(),
  period_end: z.string().datetime(),
  total_trades: z.number().int().min(0),
  win_rate: z.number().min(0).max(1),
  profit_factor: z.number().min(0),
  sharpe_ratio: z.number(),
  sortino_ratio: z.number(),
  max_drawdown: z.number(),
  total_pnl: z.number(),
  avg_trade_duration_ms: z.number().min(0),
});
export type StrategyPerformance = z.infer<typeof StrategyPerformanceContract>;

/* ── All Contracts (for validation helpers) ─────────────────────────────────── */
export const ALL_CONTRACTS = {
  Signal: SignalContract,
  Order: OrderContract,
  Position: PositionContract,
  RiskAssessment: RiskAssessmentContract,
  MarketTick: MarketTickContract,
  OHLCVBar: OHLCVBarContract,
  BrainEvent: BrainEventContract,
  StrategyPerformance: StrategyPerformanceContract,
} as const;
