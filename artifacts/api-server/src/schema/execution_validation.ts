/**
 * execution_validation.ts — schema stub
 * ─────────────────────────────────────────────────────────────────────────────
 * Minimal drizzle-like export surface so execution_validator.ts and the
 * execution_validation routes can type-check without requiring a fully
 * wired Drizzle schema file. At runtime these symbols are not used
 * directly — the validator operates via the raw better-sqlite3 interface.
 * ─────────────────────────────────────────────────────────────────────────────
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const executionValidations: any = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const slippageDistributions: any = {};
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const executionDriftEvents: any = {};

export interface ExecutionValidation {
  id?: number | string;
  orderUuid: string;
  strategyId: string;
  symbol: string;
  side: "buy" | "sell";
  expectedPrice: number;
  actualPrice: number;
  slippageBps: number;
  venue: string;
  timestamp: Date | string | number;
  [extra: string]: unknown;
}

export interface SlippageDistribution {
  id?: number | string;
  strategyId: string;
  symbol: string;
  bucket: string;
  count: number;
  sumSlippage: number;
  [extra: string]: unknown;
}

export interface ExecutionDriftEvent {
  id?: number | string;
  strategyId: string;
  symbol: string;
  driftBps: number;
  detectedAt: Date | string | number;
  [extra: string]: unknown;
}
