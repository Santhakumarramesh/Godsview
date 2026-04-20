/**
 * Portfolio Intelligence primitives — Phase 6 surface.
 *
 * Phase 4 shipped a per-account execution bus (`positions`,
 * `live_trades`, `account_equity_snapshots`). Phase 6 rolls that
 * ledger up into a portfolio-level view:
 *
 *   Positions + LiveTrades + AccountEquity
 *                   │
 *                   ├──►  CorrelationClass buckets
 *                   │
 *                   ├──►  PortfolioExposure (per-symbol + per-class)
 *                   │
 *                   ├──►  AllocationPlan (strategy-level targets)
 *                   │
 *                   └──►  PortfolioPnL (daily / equity curve / drawdown)
 *
 * The portfolio engine is read-biased — it doesn't mutate Phase 4 state.
 * The only mutation surface is `AllocationPlan.set` (admin-gated) which
 * persists an allocation target that the strategy ranking pass consults
 * on the next tick.
 *
 * Wire-shape notes:
 *   * Every timestamp is an ISO-8601 UTC string (Z suffix).
 *   * Dollar notionals are `number`; R-denominated values carry the `R`
 *     suffix in the field name (same convention as Phase 4).
 *   * camelCase over the wire — Pydantic v2 models use populate_by_name.
 */
import { z } from "zod";
import { DirectionSchema } from "./market.js";

// ──────────────────────────── correlation classes ─────────────────────

/**
 * Canonical correlation bucket for a symbol. The live gate's correlated-
 * exposure cap (Phase 4) reads this; the portfolio allocator uses it to
 * surface concentration warnings + per-class budget consumption.
 *
 * Mapping is held in `system_config.portfolio.correlation_map` keyed by
 * `symbol_id`; unknown symbols fall back to `other`.
 */
export const CorrelationClassSchema = z.enum([
  "equity_index",
  "single_stock",
  "crypto_major",
  "crypto_alt",
  "fx_major",
  "fx_minor",
  "commodity",
  "treasury",
  "other",
]);
export type CorrelationClass = z.infer<typeof CorrelationClassSchema>;

// ──────────────────────────── per-symbol exposure ─────────────────────

/**
 * One row per symbol with a non-zero position across any account the
 * operator owns. A closed symbol (`qty == 0`) does not appear.
 */
export const PortfolioSymbolExposureSchema = z.object({
  symbolId: z.string(),
  correlationClass: CorrelationClassSchema,
  direction: DirectionSchema,
  qty: z.number(),
  notional: z.number(),
  /** Current unrealised PnL in dollars (mark - avg entry, signed). */
  unrealizedPnl: z.number(),
  /** Unrealised PnL denominated in R — useful for DNA roll-ups. */
  unrealizedR: z.number().nullable(),
  /** Percent of total account equity this position represents. */
  percentOfEquity: z.number(),
  /** Active setups + live-trade rows that opened this leg, for drilldown. */
  setupIds: z.array(z.string()),
  liveTradeIds: z.array(z.string()),
});
export type PortfolioSymbolExposure = z.infer<
  typeof PortfolioSymbolExposureSchema
>;

// ──────────────────────────── per-class exposure ─────────────────────

/**
 * Aggregated exposure per correlation class. The live gate's
 * `maxCorrelatedExposure` (Phase 4 `RiskBudget`) is evaluated against
 * the long/short nets inside each class.
 */
export const PortfolioClassExposureSchema = z.object({
  correlationClass: CorrelationClassSchema,
  symbolCount: z.number().int().nonnegative(),
  netNotional: z.number(),
  grossNotional: z.number(),
  netPercentOfEquity: z.number(),
  grossPercentOfEquity: z.number(),
});
export type PortfolioClassExposure = z.infer<
  typeof PortfolioClassExposureSchema
>;

// ──────────────────────────── report envelope ────────────────────────

/**
 * Point-in-time portfolio exposure report. One row per account, observed
 * at `observedAt`. `warnings` carry any breached caps (evaluated against
 * the Phase 4 `RiskBudget`).
 */
export const PortfolioExposureWarningSchema = z.object({
  code: z.enum([
    "gross_exposure_breach",
    "correlated_exposure_breach",
    "single_symbol_concentration",
    "drawdown_cap_approaching",
    "cross_account_duplication",
  ]),
  severity: z.enum(["info", "warn", "critical"]),
  message: z.string(),
  subjectKey: z.string().nullable(),
});
export type PortfolioExposureWarning = z.infer<
  typeof PortfolioExposureWarningSchema
>;

export const PortfolioExposureReportSchema = z.object({
  accountId: z.string(),
  observedAt: z.string().datetime(),
  totalEquity: z.number(),
  grossNotional: z.number(),
  netNotional: z.number(),
  grossPercentOfEquity: z.number(),
  netPercentOfEquity: z.number(),
  bySymbol: z.array(PortfolioSymbolExposureSchema),
  byCorrelationClass: z.array(PortfolioClassExposureSchema),
  warnings: z.array(PortfolioExposureWarningSchema),
});
export type PortfolioExposureReport = z.infer<
  typeof PortfolioExposureReportSchema
>;

export const PortfolioExposureFilterSchema = z.object({
  accountId: z.string().optional(),
  asOf: z.string().datetime().optional(),
});
export type PortfolioExposureFilter = z.infer<
  typeof PortfolioExposureFilterSchema
>;

// ──────────────────────────── allocation plans ───────────────────────

/**
 * Canonical allocation state for a single strategy. `targetPercent` is
 * the operator-set target; `actualPercent` is computed from the live
 * ledger at `observedAt`. `deltaR` is the total R swing needed to
 * re-balance (positive = under-allocated, negative = over-allocated).
 *
 * Strategies without a target row inherit the catalog default
 * (`system_config.portfolio.default_strategy_target`).
 */
export const AllocationSourceSchema = z.enum([
  "operator",
  "automated",
  "inherited_default",
]);
export type AllocationSource = z.infer<typeof AllocationSourceSchema>;

export const StrategyAllocationSchema = z.object({
  strategyId: z.string(),
  targetPercent: z.number().min(0).max(1),
  actualPercent: z.number(),
  deltaR: z.number(),
  source: AllocationSourceSchema,
  /** Last time the allocation engine reviewed this row. */
  reviewedAt: z.string().datetime(),
  /** Latest tier + promotion state, copied in for operator drill-down. */
  tier: z.enum(["A", "B", "C"]),
  promotionState: z.enum([
    "experimental",
    "paper",
    "assisted_live",
    "autonomous",
    "retired",
  ]),
  /** Latest DNA tier-at-generation, or null if no DNA snapshot yet. */
  dnaTier: z.enum(["A", "B", "C"]).nullable(),
});
export type StrategyAllocation = z.infer<typeof StrategyAllocationSchema>;

export const AllocationPlanSchema = z.object({
  accountId: z.string(),
  observedAt: z.string().datetime(),
  strategies: z.array(StrategyAllocationSchema),
  /**
   * Sum of `targetPercent` across all rows. Must be ≤ 1. The allocator
   * will return a `warnings` row if the sum strays outside [0.5, 1.0].
   */
  totalTargetPercent: z.number(),
  totalActualPercent: z.number(),
  /** True if the allocation is considered in-policy as of observedAt. */
  inPolicy: z.boolean(),
  warnings: z.array(PortfolioExposureWarningSchema),
});
export type AllocationPlan = z.infer<typeof AllocationPlanSchema>;

export const AllocationUpdateRequestSchema = z.object({
  strategyId: z.string(),
  targetPercent: z.number().min(0).max(1),
  reason: z.string().min(3).max(280),
});
export type AllocationUpdateRequest = z.infer<
  typeof AllocationUpdateRequestSchema
>;

export const AllocationPlanFilterSchema = z.object({
  accountId: z.string().optional(),
});
export type AllocationPlanFilter = z.infer<typeof AllocationPlanFilterSchema>;

// ──────────────────────────── PnL timeseries ─────────────────────────

/**
 * One daily PnL row per account. Equity curve + drawdown are derived by
 * walking this table in ascending `observedDate` order.
 */
export const PortfolioPnlPointSchema = z.object({
  observedDate: z.string(),
  startEquity: z.number(),
  endEquity: z.number(),
  realized: z.number(),
  unrealized: z.number(),
  fees: z.number(),
  netPnl: z.number(),
  rToday: z.number(),
  cumulativeR: z.number(),
  drawdownR: z.number(),
  peakEquity: z.number(),
  /** Count of live-trade fills that settled on this date. */
  tradeCount: z.number().int().nonnegative(),
});
export type PortfolioPnlPoint = z.infer<typeof PortfolioPnlPointSchema>;

export const PortfolioPnlSummarySchema = z.object({
  accountId: z.string(),
  startDate: z.string(),
  endDate: z.string(),
  startingEquity: z.number(),
  endingEquity: z.number(),
  grossPnl: z.number(),
  netPnl: z.number(),
  totalR: z.number(),
  maxDrawdownR: z.number(),
  winRate: z.number(),
  tradeCount: z.number().int().nonnegative(),
  winningTrades: z.number().int().nonnegative(),
  losingTrades: z.number().int().nonnegative(),
  scratchTrades: z.number().int().nonnegative(),
  bestDayR: z.number(),
  worstDayR: z.number(),
});
export type PortfolioPnlSummary = z.infer<typeof PortfolioPnlSummarySchema>;

export const PortfolioPnlReportSchema = z.object({
  summary: PortfolioPnlSummarySchema,
  points: z.array(PortfolioPnlPointSchema),
});
export type PortfolioPnlReport = z.infer<typeof PortfolioPnlReportSchema>;

export const PortfolioPnlFilterSchema = z.object({
  accountId: z.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
});
export type PortfolioPnlFilter = z.infer<typeof PortfolioPnlFilterSchema>;

// ──────────────────────────── account registry ───────────────────────

/**
 * Thin projection of a portfolio-bearing account for selector UIs. A
 * full broker row lives in `@gv/types/execution.ts::BrokerAccountSchema`
 * (Phase 4). This schema is the minimum the portfolio pages need to
 * populate their filter dropdowns.
 */
export const PortfolioAccountSchema = z.object({
  accountId: z.string(),
  displayName: z.string(),
  provider: z.string(),
  liveEnabled: z.boolean(),
});
export type PortfolioAccount = z.infer<typeof PortfolioAccountSchema>;

export const PortfolioAccountsListSchema = z.object({
  accounts: z.array(PortfolioAccountSchema),
});
export type PortfolioAccountsList = z.infer<typeof PortfolioAccountsListSchema>;
