/**
 * brain/types.ts — Core type system for the GodsView Brain-Node Architecture
 *
 * The system is a distributed market brain:
 *   Supreme Brain → Stock Brains → Timeframe Nodes → Specialized Nodes
 *
 * Each stock is a living node with state, memory, context, and live sensory input.
 */

// ─── Core Enums ──────────────────────────────────────────────────────────────

export type MarketSession = "premarket" | "new_york" | "london" | "asia" | "power_hour" | "after_hours" | "closed";
export type Bias = "bullish" | "bearish" | "neutral";
export type Confidence = number; // 0.0 – 1.0
export type SetupFamily =
  | "sweep_reclaim"
  | "absorption_reversal"
  | "continuation_pullback"
  | "cvd_divergence"
  | "breakout_failure"
  | "liquidity_grab"
  | "fvg_fill"
  | "order_block_retest";
export type NodeHealth = "live" | "degraded" | "offline" | "initializing";
export type Regime = "trending_bull" | "trending_bear" | "ranging" | "volatile" | "chop";
export type BrainState = "scanning" | "watching" | "ready" | "entry_pending" | "in_position" | "cooldown" | "blocked";
export type Timeframe = "tick" | "1m" | "5m" | "15m" | "1h" | "4h" | "1d";

// ─── Timeframe Node Opinion ──────────────────────────────────────────────────

export type TimeframeOpinion = {
  timeframe: Timeframe;
  bias: Bias;
  confidence: Confidence;
  regime: Regime;
  invalidation_level: number;
  strongest_setup: SetupFamily | null;
  key_level_above: number;
  key_level_below: number;
  momentum: number;         // -1 to 1
  structure_score: number;  // 0 to 1
  updated_at: string;
};

// ─── Tick State ──────────────────────────────────────────────────────────────

export type TickState = {
  tick_velocity: number;       // ticks per second normalized
  aggression_score: number;    // 0–1 buy vs sell aggression
  micro_reversal_score: number; // 0–1 probability of micro reversal
  burst_probability: number;   // 0–1 probability of momentum burst
  tape_speed: number;          // relative to normal
  spread_state: "tight" | "normal" | "wide";
  last_update: string;
};

// ─── Price State ─────────────────────────────────────────────────────────────

export type PriceState = {
  last: number;
  bid: number;
  ask: number;
  spread: number;
  spread_pct: number;
  atr: number;
  atr_pct: number;
  relative_volatility: number; // vs 20-period avg
  vwap: number;
  distance_from_vwap_pct: number;
};

// ─── Order Flow State ────────────────────────────────────────────────────────

export type OrderFlowState = {
  delta_score: number;         // -1 to 1 (positive = buying pressure)
  cvd_trend: "up" | "down" | "flat";
  cvd_slope: number;
  absorption_score: number;    // 0–1 absorption detected
  imbalance_score: number;     // 0–1 buy/sell imbalance
  buy_volume_ratio: number;    // 0–1
  large_delta_bar: boolean;
  cvd_divergence: boolean;
  delta_momentum: number;
};

// ─── Structure State ─────────────────────────────────────────────────────────

export type StructureState = {
  htf_bias: Bias;              // 1h+ bias
  itf_bias: Bias;              // 5m-15m bias
  ltf_bias: Bias;              // 1m bias
  bos_count: number;           // break of structure count
  choch_detected: boolean;     // change of character
  sweep_detected: boolean;     // liquidity sweep in last N bars
  active_order_blocks: Array<{
    timeframe: Timeframe;
    side: "demand" | "supply";
    low: number;
    high: number;
    strength: number;
    mitigated: boolean;
  }>;
  fvg_zones: Array<{
    side: "bullish" | "bearish";
    low: number;
    high: number;
    filled_pct: number;
  }>;
  distance_to_key_zone_pct: number;
  premium_discount: "premium" | "discount" | "equilibrium";
  swing_high: number;
  swing_low: number;
  sk_sequence_stage: "impulse" | "correction" | "completion" | "none";
  sk_in_zone: boolean;
  sk_score: number;
};

// ─── Liquidity State ─────────────────────────────────────────────────────────

export type LiquidityState = {
  equal_highs_nearby: boolean;
  equal_lows_nearby: boolean;
  resting_liquidity_above: number;  // 0–1 strength
  resting_liquidity_below: number;  // 0–1 strength
  stop_hunt_probability: number;    // 0–1
  nearest_liquidity_pool_above: number; // price level
  nearest_liquidity_pool_below: number; // price level
};

// ─── Event Context ───────────────────────────────────────────────────────────

export type EventContext = {
  earnings_near: boolean;
  earnings_days_away: number | null;
  news_heat: number;            // 0–1
  macro_pressure: "supportive" | "neutral" | "hostile";
  sector_alignment: number;     // -1 to 1
  vix_regime: "low" | "normal" | "elevated" | "extreme";
  fed_proximity: boolean;       // near FOMC/data release
  market_session: MarketSession;
  session_quality: number;      // 0–1 (some sessions are better than others)
};

// ─── Memory State ────────────────────────────────────────────────────────────

export type MemoryCluster = {
  setup_family: SetupFamily;
  regime: Regime;
  sample_count: number;
  win_rate: number;
  profit_factor: number;
  avg_r_multiple: number;
  best_sessions: MarketSession[];
  avg_hold_bars: number;
  decay_score: number;         // 0–1, 1 = still effective
  last_updated: string;
};

export type MemoryState = {
  closest_setup_cluster: SetupFamily | null;
  cluster_similarity: number;  // 0–1
  cluster_win_rate: number;
  cluster_profit_factor: number;
  similar_cases_count: number;
  symbol_personality: {
    trendiness: number;        // 0–1 (1 = strong trend tendency)
    mean_reversion: number;    // 0–1
    news_sensitivity: number;  // 0–1
    sweep_reaction: number;    // 0–1 (how it reacts to liquidity sweeps)
    best_timeframe: Timeframe;
    best_session: MarketSession;
    best_setup: SetupFamily;
  };
  recent_outcomes: Array<{
    setup: SetupFamily;
    outcome: "win" | "loss" | "breakeven";
    r_multiple: number;
    timestamp: string;
  }>;
  clusters: MemoryCluster[];
};

// ─── Decision State ──────────────────────────────────────────────────────────

export type Decision = {
  state: BrainState;
  confidence: Confidence;
  setup_name: string | null;
  setup_family: SetupFamily | null;
  entry_quality: number;       // 0–1
  direction: "long" | "short" | null;
  entry_price: number | null;
  stop_loss: number | null;
  take_profit: number | null;
  position_size: number | null;
  conditions_to_trigger: string[];
  conditions_to_block: string[];
  reasoning_summary: string;
  risk_approved: boolean;
  last_updated: string;
};

// ─── Reasoning Verdict (Claude Output) ───────────────────────────────────────

export type ReasoningVerdict = {
  verdict: "strong_long" | "watch_long" | "neutral" | "watch_short" | "strong_short" | "no_trade";
  confidence: Confidence;
  reason: string;
  key_factors: string[];
  contradictions: string[];
  conditions_to_trigger: string[];
  conditions_to_block: string[];
  scenario_ranking: Array<{
    scenario: string;
    probability: number;
    action: string;
  }>;
  memory_comparison: string;
  risk_assessment: string;
  latency_ms: number;
  computed_at: string;
};

// ─── Risk Gate ───────────────────────────────────────────────────────────────

export type RiskGate = {
  tradeable: boolean;
  reason: string;
  max_position_size_usd: number;
  max_loss_usd: number;
  stop_distance_atr: number;
  reward_risk_ratio: number;
  portfolio_heat_pct: number;    // current risk as % of portfolio
  daily_loss_remaining_pct: number;
  correlation_check: boolean;    // not too correlated with existing positions
  slippage_estimate_pct: number;
};

// ─── Evolution Metrics ───────────────────────────────────────────────────────

export type EvolutionMetrics = {
  total_trades: number;
  win_rate_7d: number;
  win_rate_30d: number;
  profit_factor_7d: number;
  profit_factor_30d: number;
  avg_r_multiple: number;
  best_performing_node: string;
  worst_performing_node: string;
  confidence_calibration: number;  // 0–1 (1 = perfect calibration)
  decay_alerts: string[];          // setups that have stopped working
  threshold_adjustments: Array<{
    setup: SetupFamily;
    field: string;
    old_value: number;
    new_value: number;
    reason: string;
  }>;
  last_evolution_run: string;
};

// ─── Complete Stock Brain State ──────────────────────────────────────────────

export type StockBrainState = {
  symbol: string;
  display_name: string;
  asset_class: "crypto" | "equity" | "futures" | "forex";
  market_status: "open" | "premarket" | "afterhours" | "closed";

  // Attention & priority (set by Supreme Brain)
  attention_level: "high" | "medium" | "low" | "dormant";
  attention_score: number;     // 0–1 composite
  compute_priority: number;    // 1–10

  // Core states
  price: PriceState;
  ticks: TickState;
  order_flow: OrderFlowState;
  structure: StructureState;
  liquidity: LiquidityState;
  event_context: EventContext;
  memory: MemoryState;
  decision: Decision;

  // Multi-timeframe opinions
  timeframe_opinions: Record<Timeframe, TimeframeOpinion>;

  // Reasoning & risk
  last_reasoning: ReasoningVerdict | null;
  risk_gate: RiskGate;

  // Health
  node_health: NodeHealth;
  data_freshness_ms: number;
  last_full_update: string;
  error: string | null;
};

// ─── Supreme Brain State ─────────────────────────────────────────────────────

export type SupremeBrainState = {
  // Market-wide assessment
  market_regime: Regime;
  market_regime_confidence: Confidence;
  risk_appetite: "aggressive" | "normal" | "defensive" | "risk_off";
  portfolio_heat_pct: number;
  total_equity: number;
  daily_pnl: number;
  daily_pnl_pct: number;

  // Active stocks (ranked by attention)
  active_symbols: string[];
  symbol_rankings: Array<{
    symbol: string;
    attention_score: number;
    setup_quality: number;
    readiness: number;
  }>;

  // Capital allocation
  max_concurrent_positions: number;
  current_positions: number;
  available_capital_pct: number;

  // Global signals
  macro_context: EventContext;
  vix_level: number;
  market_breadth: number;      // -1 to 1

  // Evolution state
  evolution: EvolutionMetrics;

  // Health
  total_nodes_active: number;
  total_nodes_degraded: number;
  system_health: "healthy" | "degraded" | "critical";
  last_update: string;
};

// ─── Consciousness Board (UI Data) ──────────────────────────────────────────

export type ConsciousnessCard = {
  symbol: string;
  attention: "HIGH" | "MEDIUM" | "LOW" | "DORMANT";
  bias: string;
  setup: string;
  memory_match_pct: number;
  readiness_pct: number;
  risk_state: "Allowed" | "Blocked" | "Caution";
  brain_verdict: string;
  c4_score: number;
  regime: string;
  node_health: NodeHealth;
};

export type ConsciousnessBoard = {
  supreme: SupremeBrainState;
  cards: ConsciousnessCard[];
  timestamp: string;
};

// ─── Adaptive Rules (Evolution Engine) ───────────────────────────────────────

export type AdaptiveRules = Record<SetupFamily, {
  min_structure_score: number;
  min_orderflow_score: number;
  min_memory_alignment: number;
  blocked_during_high_news_heat: boolean;
  best_sessions: MarketSession[];
  max_atr_pct: number;
  min_confidence: number;
  cooldown_bars: number;
}>;
