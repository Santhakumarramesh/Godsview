/**
 * Strategy DSL - Canonical representation of any trading strategy
 *
 * This defines the internal language for representing strategies with:
 * - Market context (regime, session, volatility filters)
 * - Entry conditions (price action, indicators, orderflow)
 * - Exit rules (stop loss, take profit, trailing stops)
 * - Position sizing (Kelly, volatility-adjusted, fixed)
 * - Risk management and filters
 *
 * The goal: unambiguous, executable representation of any strategy
 */

export interface StrategyDSL {
  // Metadata
  id: string;
  version: number;
  name: string;
  description: string;
  author: string;
  createdAt: string;

  // Core strategy definition
  marketContext: MarketContextSpec;
  entry: EntrySpec;
  exit: ExitSpec;
  sizing: SizingSpec;
  /**
   * Per-trade filters applied at signal time.
   * Discriminated union of named filter types (trend, volatility, volume,
   * range, time, custom). Authors can keep this empty for "no extra
   * filtering beyond the constraints object".
   */
  filters: FilterSpec[];
  /**
   * Cross-trade constraints (quality thresholds, correlation caps,
   * cooldowns, blackout windows). Renamed from the old `filters` object.
   * `filters` is kept for backward compat but is read at runtime from
   * `constraints` when present.
   */
  constraints: ConstraintsSpec;

  // Meta information
  complexity: 'simple' | 'moderate' | 'complex' | 'advanced';
  estimatedEdgeSource: string;
  bestRegimes: string[];
  worstRegimes: string[];
  timeframes: string[];
  symbols: string[];

  // Compilation metadata
  parseConfidence: number;
  ambiguities: Ambiguity[];
  warnings: string[];
}

export interface MarketContextSpec {
  regimeFilter: RegimeFilter;
  sessionFilter: SessionFilter;
  volatilityFilter: VolatilityFilter;
  trendFilter: TrendFilter;
  macroFilter?: MacroFilter;
  /** Minimum number of historical bars required before strategy can trade. */
  minDataPoints?: number;
}
export interface RegimeFilter {
  allowed: ('trending_up' | 'trending_down' | 'ranging' | 'volatile' | 'quiet')[];
  blocked: string[];
  minStrength: number;
}

export interface SessionFilter {
  allowedSessions: ('premarket' | 'us_open' | 'us_morning' | 'us_afternoon' | 'us_close' | 'london' | 'asia' | 'overlap')[];
  avoidEvents: boolean;
  minMinutesFromOpen?: number;
}

export interface VolatilityFilter {
  minATR?: number;
  maxATR?: number;
  minIV?: number;
  maxIV?: number;
  preferExpanding: boolean;
}

export interface TrendFilter {
  requiredTrend?: 'up' | 'down' | 'any';
  minTrendStrength?: number;
  mtfAlignment?: boolean;
  mtfTimeframes?: string[];
}

export interface MacroFilter {
  avoidFOMC: boolean;
  avoidNFP: boolean;
  avoidCPI: boolean;
  avoidEarnings: boolean;
  preferRiskOn?: boolean;
}

export interface EntrySpec {
  type: 'limit' | 'market' | 'stop' | 'conditional';
  /**
   * Either typed EntryCondition objects (preferred) or free-form strings
   * (legacy / generated descriptions). Critique helpers may treat strings
   * directly; downstream executors should branch on typeof === 'string'.
   */
  conditions: Array<EntryCondition | string>;
  confirmations: ConfirmationSpec[];
  minConfirmationsRequired: number;
  /** Legacy alias for `minConfirmationsRequired` used by variant generator. */
  confirmationBars?: number;
  entryZone?: {
    type: 'orderblock' | 'fvg' | 'support_resistance' | 'vwap' | 'ema' | 'custom';
    params: Record<string, any>;
  };
  aggressiveness: 'conservative' | 'moderate' | 'aggressive';
}export interface EntryCondition {
  id: string;
  name: string;
  type: 'price_action' | 'indicator' | 'orderflow' | 'structure' | 'pattern' | 'level' | 'custom';
  operator: 'crosses_above' | 'crosses_below' | 'is_above' | 'is_below' | 'equals' | 'between' | 'touches' | 'breaks' | 'reclaims' | 'rejects';
  params: Record<string, any>;
  weight: number;
  required: boolean;
}

export interface ConfirmationSpec {
  id: string;
  name: string;
  type: 'volume' | 'momentum' | 'structure' | 'orderflow' | 'candle_pattern' | 'divergence';
  params: Record<string, any>;
  weight: number;
}

export interface ExitSpec {
  stopLoss: StopLossSpec;
  takeProfit: TakeProfitSpec;
  trailingStop?: TrailingStopSpec;
  timeExit?: TimeExitSpec;
  invalidation?: InvalidationSpec;
  /**
   * Optional flat list of profit targets used by some critique / replay
   * tooling. When present, runtime should prefer `takeProfit.targets`.
   */
  profitTargets?: Array<{ ratio: number; closePercent: number }>;
  /**
   * Free-form labels describing exit methods (e.g. "trailing", "time",
   * "structure_break") for narrative / scoring purposes.
   */
  exitMethods?: string[];
}

export interface StopLossSpec {
  type: 'fixed_atr' | 'structure' | 'percentage' | 'dollar' | 'swing_low_high' | 'custom';
  value: number;
  buffer?: number;
}

export interface TakeProfitSpec {
  type: 'fixed_rr' | 'structure' | 'atr_multiple' | 'partial_scaling';
  targets: { ratio: number; closePercent: number }[];
  minRR: number;
}

export interface TrailingStopSpec {
  activationR: number;
  trailMethod: 'atr' | 'percentage' | 'structure' | 'chandelier';
  trailValue: number;
}

export interface TimeExitSpec {
  maxBarsInTrade: number;
  maxHoursInTrade?: number;
  forceExitBeforeClose: boolean;
}

export interface InvalidationSpec {
  conditions: string[];
  description: string;
}

export interface SizingSpec {
  method: 'kelly' | 'fixed_percent' | 'volatility_adjusted' | 'risk_parity';
  maxRiskPercent: number;
  maxPositionPercent: number;
  kellyFraction?: number;
  scalingRules?: { condition: string; adjustment: number }[];
  /** Legacy: relative position-size multiplier (1.0 = base). */
  baseSize?: number;
  /** Legacy alias for `maxPositionPercent` (as a fraction of equity). */
  maxSize?: number;
}

/**
 * Cross-trade constraints applied at the portfolio / governor level.
 * Renamed from the old `FilterSpec` object shape; kept as a separate
 * interface to avoid colliding with the per-trade filter union below.
 */
export interface ConstraintsSpec {
  minQualityScore: number;
  minEdgeScore: number;
  maxCorrelation: number;
  maxOpenPositions: number;
  cooldownBars: number;
  blackoutPeriods: string[];
}

/**
 * Per-trade filter. Discriminated union by `type`. Unknown types fall
 * through to the `custom` branch so the type remains extensible without
 * source churn when new filter families are added.
 */
export type FilterSpec =
  | TrendFilterSpec
  | VolatilityFilterSpec
  | VolumeFilterSpec
  | RangeFilterSpec
  | TimeFilterSpec
  | CustomFilterSpec;

export interface TrendFilterSpec {
  type: 'trend';
  direction?: 'any' | 'up' | 'down';
  strength?: 'weak' | 'moderate' | 'strong';
  [k: string]: unknown;
}

export interface VolatilityFilterSpec {
  type: 'volatility';
  minAtr?: number;
  maxAtr?: number;
  [k: string]: unknown;
}

export interface VolumeFilterSpec {
  type: 'volume';
  minVolume?: number;
  [k: string]: unknown;
}

export interface RangeFilterSpec {
  type: 'range';
  minRange?: number;
  maxRange?: number;
  [k: string]: unknown;
}

export interface TimeFilterSpec {
  type: 'time';
  allowedHours?: number[];
  excludeWeekends?: boolean;
  [k: string]: unknown;
}

export interface CustomFilterSpec {
  type: string; // anything other than the known types falls here at runtime
  [k: string]: unknown;
}

export interface Ambiguity {
  field: string;
  issue: string;
  defaultUsed: any;
  alternatives: any[];
  confidence: number;
}

/**
 * Create an empty strategy with sensible defaults
 */
export function createEmptyStrategy(name: string): StrategyDSL {
  const now = new Date().toISOString();

  return {
    id: `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    version: 1,
    name,
    description: '',
    author: 'Unknown',
    createdAt: now,

    marketContext: {
      regimeFilter: {
        allowed: ['trending_up', 'trending_down', 'ranging'],
        blocked: [],
        minStrength: 0.5,
      },
      sessionFilter: {
        allowedSessions: ['us_open', 'us_morning', 'us_afternoon'],
        avoidEvents: true,
        minMinutesFromOpen: 5,
      },
      volatilityFilter: {
        preferExpanding: false,
      },
      trendFilter: {
        requiredTrend: 'any',
        mtfAlignment: false,
      },
    },

    entry: {
      type: 'market',
      conditions: [],
      confirmations: [],
      minConfirmationsRequired: 1,
      aggressiveness: 'moderate',
    },

    exit: {
      stopLoss: {
        type: 'fixed_atr',
        value: 1.0,
      },
      takeProfit: {
        type: 'fixed_rr',
        targets: [{ ratio: 2.0, closePercent: 1.0 }],
        minRR: 1.5,
      },
    },

    sizing: {
      method: 'fixed_percent',
      maxRiskPercent: 1.0,
      maxPositionPercent: 5.0,
    },

    filters: [],
    constraints: {
      minQualityScore: 0.6,
      minEdgeScore: 0.55,
      maxCorrelation: 0.7,
      maxOpenPositions: 3,
      cooldownBars: 0,
      blackoutPeriods: [],
    },

    complexity: 'simple',
    estimatedEdgeSource: 'unknown',
    bestRegimes: [],
    worstRegimes: [],
    timeframes: ['1m', '5m'],
    symbols: [],

    parseConfidence: 0,
    ambiguities: [],
    warnings: [],
  };
}

/**
 * Validate a strategy DSL for completeness and logical consistency
 */
export function validateStrategyDSL(strategy: StrategyDSL): {
  valid: boolean;
  errors: string[];
  warnings: string[];
} {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Required fields
  if (!strategy.id) errors.push('Strategy must have an id');
  if (!strategy.name) errors.push('Strategy must have a name');
  if (!strategy.entry.conditions || strategy.entry.conditions.length === 0) {
    warnings.push('Strategy has no entry conditions');
  }
  if (strategy.exit.takeProfit.targets.length === 0) {
    errors.push('Strategy must have at least one take profit target');
  }

  // Logical checks
  if (strategy.sizing.maxRiskPercent > 5) {
    warnings.push(`Risk per trade (${strategy.sizing.maxRiskPercent}%) exceeds typical best practices`);
  }
  if (strategy.exit.takeProfit.minRR < 1.0) {
    errors.push('Minimum RR must be >= 1.0');
  }
  if (
    strategy.constraints.minQualityScore < 0 ||
    strategy.constraints.minQualityScore > 1
  ) {
    errors.push('minQualityScore must be between 0 and 1');
  }
  if (strategy.marketContext.regimeFilter.minStrength < 0 || strategy.marketContext.regimeFilter.minStrength > 1) {
    errors.push('Regime filter minStrength must be between 0 and 1');
  }

  // Check if entry conditions have reasonable weights. Conditions can be
  // either typed EntryCondition objects (with .weight) or free-form strings;
  // strings are treated as weight=0 / non-required for validator math.
  const typedConditions = strategy.entry.conditions.filter(
    (c): c is EntryCondition => typeof c !== 'string',
  );
  const totalWeight = typedConditions.reduce((sum, c) => sum + c.weight, 0);
  if (totalWeight === 0 && strategy.entry.conditions.length > 0) {
    warnings.push('Entry conditions have zero total weight');
  }

  // Confirm required conditions match minimum confirmations
  const requiredCount = typedConditions.filter((c) => c.required).length;
  if (requiredCount > strategy.entry.minConfirmationsRequired) {
    errors.push(
      `${requiredCount} required conditions exceed minConfirmationsRequired (${strategy.entry.minConfirmationsRequired})`
    );
  }

  return {
    valid: errors.length === 0,
    errors,
    warnings,
  };
}

/**
 * Serialize a strategy DSL to JSON string
 */
export function serializeStrategy(strategy: StrategyDSL): string {
  return JSON.stringify(strategy, null, 2);
}

/**
 * Deserialize a strategy DSL from JSON string
 */
export function deserializeStrategy(json: string): StrategyDSL {
  return JSON.parse(json) as StrategyDSL;
}

/**
 * Clone a strategy with a new ID
 */
export function cloneStrategy(strategy: StrategyDSL, newName?: string): StrategyDSL {
  const cloned = JSON.parse(JSON.stringify(strategy)) as StrategyDSL;
  cloned.id = `strategy_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  cloned.version = 1;
  cloned.createdAt = new Date().toISOString();
  if (newName) cloned.name = newName;
  return cloned;
}

/**
 * Compute a hash of strategy parameters for comparison
 */
export function strategyHash(strategy: StrategyDSL): string {
  const key = JSON.stringify({
    entry: strategy.entry,
    exit: strategy.exit,
    sizing: strategy.sizing,
    marketContext: strategy.marketContext,
  });
  return hashString(key);
}

function hashString(str: string): string {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32-bit integer
  }
  return Math.abs(hash).toString(36);
}