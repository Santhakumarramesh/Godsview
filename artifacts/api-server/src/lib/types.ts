/**
 * types.ts — Shared lightweight type stubs used by legacy quant modules.
 *
 * These permissive interfaces unblock typechecking for strategy/quant code
 * that pre-dated the typed schema. Fields are all optional with index
 * signatures so downstream modules can extend them freely.
 */

export interface StrategyRule {
  type?: string;
  [extra: string]: unknown;
}

export interface PositionSizingRules {
  type?: string;
  [extra: string]: unknown;
}

export interface Strategy {
  id?: string;
  name?: string;
  type?: string;
  entryRules?: StrategyRule[];
  exitRules?: StrategyRule[];
  indicators?: Array<{ type?: string; [extra: string]: unknown }>;
  positionSizingRules?: PositionSizingRules;
  minLiquidity?: number;
  maxDrawdown?: number;
  maxConcurrentPositions?: number;
  instruments?: string[];
  targetMarketCap?: string | number;
  targetRegimes?: string[];
  regimeFilters?: unknown;
  averageHoldingPeriod?: number;
  orderType?: string;
  parameters?: Record<string, unknown>;
  trainingSchedule?: unknown;
  metaStrategy?: Record<string, unknown>;
  [extra: string]: unknown;
}

export interface BacktestResult {
  totalTrades: number;
  totalReturn: number;
  winRate?: number;
  sharpeRatio?: number;
  outOfSampleSharpe?: number;
  maxDrawdown: number;
  maxDrawdownRecoveryDays?: number;
  profitFactor?: number;
  worstMonthReturn?: number;
  commissionsIncluded?: boolean;
  slippageAssumed?: number;
  spreadAssumed?: number;
  liquidityCheck?: boolean;
  parameterSensitivity?: Record<string, number>;
  regimePerformance?: Record<string, unknown>;
  rollingWindowSharpe?: number[];
  [extra: string]: unknown;
}

export interface MarketData {
  timestamp: string | number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  [extra: string]: unknown;
}
