/**
 * dsl_types.ts — Phase 32 Strategy DSL Type Definitions
 *
 * Domain-specific language types for natural language strategy compilation.
 *
 * Exports:
 *   - StrategyDSL: Complete strategy specification
 *   - EntryCondition: Entry signal definition
 *   - ExitCondition: Exit signal definition
 *   - TimeFilter: Market session and day filters
 *   - VolatilityFilter: Volatility-based conditions
 *   - PositionSizing: Position sizing configuration
 */

/**
 * Entry condition with indicator-based trigger
 */
export interface EntryCondition {
  /** Identifier (e.g., "rsi_oversold", "ma_crossover_1") */
  id: string;

  /** Technical indicator name (e.g., "rsi", "ema", "price") */
  indicator: string;

  /** Comparison operator */
  comparator: "gt" | "lt" | "gte" | "lte" | "crosses_above" | "crosses_below" | "equals";

  /** Comparison value (threshold or reference value) */
  value: number;

  /** Secondary value for ranges (e.g., for price between X and Y) */
  value2?: number;

  /** Timeframe (e.g., "1m", "5m", "1h", "daily") */
  timeframe: string;

  /** Logic operator for combining with other conditions */
  logic_operator: "and" | "or";

  /** Optional description for UI display */
  description?: string;
}

/**
 * Exit condition with multiple exit types
 */
export interface ExitCondition {
  /** Identifier (e.g., "stop_loss_1", "take_profit_1") */
  id: string;

  /** Exit type */
  type: "stop_loss" | "take_profit" | "trailing_stop" | "time_exit" | "signal_exit";

  /** Exit value (threshold, percent, or bars/minutes) */
  value: number;

  /** Unit for the exit value */
  unit: "percent" | "dollars" | "points" | "bars" | "minutes";

  /** Secondary value for trailing stop (e.g., trail percentage) */
  trail_value?: number;

  /** Optional description */
  description?: string;
}

/**
 * Market session and day filters
 */
export interface TimeFilter {
  /** Market session */
  session: "pre_market" | "regular" | "after_hours" | "all";

  /** Days of week (0-6, 0 = Sunday) */
  days_of_week: number[];

  /** Exclude holidays (ISO date strings) */
  exclude_dates?: string[];

  /** Only trade after this time (HH:MM) */
  start_time?: string;

  /** Stop trading before this time (HH:MM) */
  end_time?: string;
}

/**
 * Volatility-based condition filter
 */
export interface VolatilityFilter {
  /** Volatility metric */
  metric: "atr" | "iv" | "rvol" | "std_dev";

  /** Comparison operator */
  comparator: "gt" | "lt" | "gte" | "lte";

  /** Threshold value */
  threshold: number;

  /** Timeframe for volatility calculation */
  timeframe: string;

  /** Optional description */
  description?: string;
}

/**
 * Position sizing configuration
 */
export interface PositionSizing {
  /** Sizing type */
  type: "fixed" | "percent_equity" | "volatility_adjusted" | "kelly";

  /** Base value (dollars for fixed, percent for percent_equity, etc.) */
  value: number;

  /** Maximum position size as percent of account equity */
  max_position_pct: number;

  /** Minimum position size (in dollars or contracts) */
  min_position?: number;

  /** For volatility-adjusted: use ATR-based scaling */
  atr_multiplier?: number;

  /** For Kelly: fraction of Kelly to use (e.g., 0.25 = quarter Kelly) */
  kelly_fraction?: number;
}

/**
 * Complete strategy specification in DSL form
 */
export interface StrategyDSL {
  /** Unique strategy identifier */
  strategy_id: string;

  /** Strategy name */
  name: string;

  /** Strategy version (semantic versioning) */
  version: string;

  /** Entry conditions (at least one required) */
  entry_conditions: EntryCondition[];

  /** Exit conditions (stop loss required, take profit recommended) */
  exit_conditions: ExitCondition[];

  /** Optional invalidation rules (conditions that cancel entry setup) */
  invalidation_rules?: EntryCondition[];

  /** Stop loss as percent of position */
  stop_loss: number;

  /** Take profit as percent of position (optional) */
  take_profit?: number;

  /** Time filters for trading sessions/days */
  time_filters: TimeFilter[];

  /** Volatility filters (optional) */
  volatility_filters?: VolatilityFilter[];

  /** Position sizing configuration */
  position_sizing: PositionSizing;

  /** Optional metadata */
  metadata?: {
    source_prompt?: string;
    created_at?: number;
    updated_at?: number;
    risk_level?: "conservative" | "moderate" | "aggressive";
    tags?: string[];
  };
}

/**
 * Validation result for DSL
 */
export interface DSLValidationResult {
  valid: boolean;
  errors: {
    field: string;
    message: string;
  }[];
  warnings: {
    field: string;
    message: string;
  }[];
}
