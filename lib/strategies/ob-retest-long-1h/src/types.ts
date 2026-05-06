/**
 * Types for the 1H Order Block Retest Long strategy.
 *
 * The bar shape (Timestamp/Open/High/Low/Close/Volume PascalCase) matches the
 * existing repo convention (artifacts/api-server/src/lib/schemas.ts SMCBarSchema).
 *
 * Everything in this module is pure: no Date.now(), no random, no I/O.
 */

export interface Bar {
  Timestamp: string;
  Open: number;
  High: number;
  Low: number;
  Close: number;
  Volume: number;
}

export interface NewsEvent {
  ts: string;
  severity: "high" | "medium" | "low";
}

export interface Config {
  atrPeriod: number;
  minDisplacementATR: number;
  stopBufferATR: number;
  takeProfitR: number;
  maxRetestBars: number;
  pivotLeft: number;
  pivotRight: number;
  minATRRatio: number;
  atrAvgWindow: number;
  newsBlockMinutes: number;
  requireBullishStructure: boolean;
  /**
   * M5c: tolerance below `obLow` before a Close-through is treated as an
   * OB break during the retest window. 0 = strict baseline (Close < obLow
   * invalidates). 0.002 = 0.2% wick-spike tolerance — useful for crypto.
   *
   * IMPORTANT: production default is 0 (strict). Backtest evidence (M5c
   * 607 evaluations across 4 symbols) shows raising this to 0.001–0.005
   * shuffles rejections between buckets without unblocking acceptance —
   * therefore it is NOT raised in the default. Exposed for future
   * experiments via env var override in the runtime adapter.
   */
  obBreakBufferPct: number;
}

export const DEFAULT_CONFIG: Config = {
  atrPeriod: 14,
  minDisplacementATR: 1.5,
  stopBufferATR: 0.25,
  takeProfitR: 2,
  maxRetestBars: 24,
  pivotLeft: 2,
  pivotRight: 2,
  minATRRatio: 0.5,
  atrAvgWindow: 50,
  newsBlockMinutes: 30,
  requireBullishStructure: true,
  obBreakBufferPct: 0,  // M5c: strict baseline; do not raise without backtest
};

/** Internal struct used during evaluation. NOT part of the output Signal. */
export interface OrderBlock1H {
  obIndex: number;
  bosIndex: number;
  obLow: number;
  obHigh: number;
  displacementATR: number;
}

export type RejectionReason =
  | "insufficient_bars"
  | "no_bos_up"
  | "no_order_block"
  | "displacement_too_small"
  | "ob_broken_before_retest"
  | "opposite_bos_before_retest"
  | "retest_window_expired"
  | "atr_too_low"
  | "news_window"
  | "regime_not_bullish";

/**
 * No-trade output. Fields: kind (discriminator), timestamp, reason.
 * Reason is the FIRST triggered rejection in the evaluation order
 * (upstream rejections take precedence).
 */
export interface NoTradeSignal {
  kind: "no_trade";
  timestamp: string;
  reason: RejectionReason;
}

/**
 * Long signal output. Fields: kind, timestamp, entry, stop, target, invalidation.
 *   - timestamp: ISO 8601 of the confirmation bar.
 *   - invalidation.obLow: a 1H close strictly below this price invalidates.
 *   - invalidation.expireAt: ISO 8601 of the bar after which the unfilled trade expires.
 */
export interface LongSignal {
  kind: "long";
  timestamp: string;
  entry: number;
  stop: number;
  target: number;
  invalidation: {
    obLow: number;
    expireAt: string;
  };
}

export type Signal = LongSignal | NoTradeSignal;
