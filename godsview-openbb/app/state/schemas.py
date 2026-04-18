"""
state/schemas.py — Core data schemas for the GodsView Brain-Node Architecture.

Every node communicates through typed state objects. These dataclasses are
the single source of truth for all inter-node data exchange.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum
from typing import Optional

# ─── Enums ────────────────────────────────────────────────────────────────────


class MarketSession(str, Enum):
    PREMARKET = "premarket"
    NEW_YORK = "new_york"
    LONDON = "london"
    ASIA = "asia"
    POWER_HOUR = "power_hour"
    AFTER_HOURS = "after_hours"
    CLOSED = "closed"


class Bias(str, Enum):
    BULLISH = "bullish"
    BEARISH = "bearish"
    NEUTRAL = "neutral"


class Regime(str, Enum):
    TRENDING_BULL = "trending_bull"
    TRENDING_BEAR = "trending_bear"
    RANGING = "ranging"
    VOLATILE = "volatile"
    CHOP = "chop"


class NodeHealth(str, Enum):
    LIVE = "live"
    DEGRADED = "degraded"
    OFFLINE = "offline"
    INITIALIZING = "initializing"


class BrainState(str, Enum):
    SCANNING = "scanning"
    WATCHING = "watching"
    READY = "ready"
    ENTRY_PENDING = "entry_pending"
    IN_POSITION = "in_position"
    COOLDOWN = "cooldown"
    BLOCKED = "blocked"


class Timeframe(str, Enum):
    TICK = "tick"
    M1 = "1m"
    M5 = "5m"
    M15 = "15m"
    H1 = "1h"
    H4 = "4h"
    D1 = "1d"


class SetupFamily(str, Enum):
    SWEEP_RECLAIM = "sweep_reclaim"
    ABSORPTION_REVERSAL = "absorption_reversal"
    CONTINUATION_PULLBACK = "continuation_pullback"
    CVD_DIVERGENCE = "cvd_divergence"
    BREAKOUT_FAILURE = "breakout_failure"
    LIQUIDITY_GRAB = "liquidity_grab"
    FVG_FILL = "fvg_fill"
    ORDER_BLOCK_RETEST = "order_block_retest"


class Attention(str, Enum):
    CRITICAL = "CRITICAL"
    HIGH = "HIGH"
    MEDIUM = "MEDIUM"
    LOW = "LOW"
    BACKGROUND = "BACKGROUND"
    DORMANT = "DORMANT"


# ─── Timeframe Node Opinion ──────────────────────────────────────────────────


@dataclass
class TimeframeOpinion:
    timeframe: Timeframe
    bias: Bias = Bias.NEUTRAL
    confidence: float = 0.0  # 0–1
    regime: Regime = Regime.RANGING
    invalidation_level: float = 0.0
    strongest_setup: Optional[SetupFamily] = None
    key_level_above: float = 0.0
    key_level_below: float = 0.0
    momentum: float = 0.0  # -1 to 1
    structure_score: float = 0.0  # 0–1
    updated_at: str = ""


# ─── Price State ──────────────────────────────────────────────────────────────


@dataclass
class PriceState:
    last: float = 0.0
    bid: float = 0.0
    ask: float = 0.0
    spread: float = 0.0
    spread_pct: float = 0.0
    atr: float = 0.0
    atr_pct: float = 0.0
    relative_volatility: float = 1.0
    vwap: float = 0.0
    distance_from_vwap_pct: float = 0.0


# ─── Tick State ───────────────────────────────────────────────────────────────


@dataclass
class TickState:
    tick_velocity: float = 0.0
    aggression_score: float = 0.5
    micro_reversal_score: float = 0.0
    burst_probability: float = 0.0
    tape_speed: float = 1.0
    spread_state: str = "normal"  # "tight" | "normal" | "wide"
    last_update: str = ""


# ─── Order Flow State ────────────────────────────────────────────────────────


@dataclass
class OrderFlowState:
    delta_score: float = 0.0  # -1 to 1
    cvd_trend: str = "flat"  # "up" | "down" | "flat"
    cvd_slope: float = 0.0
    absorption_score: float = 0.0
    imbalance_score: float = 0.0
    buy_volume_ratio: float = 0.5
    large_delta_bar: bool = False
    cvd_divergence: bool = False
    delta_momentum: float = 0.0


# ─── Order Block ──────────────────────────────────────────────────────────────


@dataclass
class OrderBlock:
    timeframe: Timeframe = Timeframe.M5
    side: str = "demand"  # "demand" | "supply"
    low: float = 0.0
    high: float = 0.0
    strength: float = 0.0
    mitigated: bool = False


# ─── FVG Zone ─────────────────────────────────────────────────────────────────


@dataclass
class FVGZone:
    side: str = "bullish"  # "bullish" | "bearish"
    low: float = 0.0
    high: float = 0.0
    filled_pct: float = 0.0


# ─── Structure State ─────────────────────────────────────────────────────────


@dataclass
class StructureState:
    htf_bias: Bias = Bias.NEUTRAL
    itf_bias: Bias = Bias.NEUTRAL
    ltf_bias: Bias = Bias.NEUTRAL
    bos_count: int = 0
    choch_detected: bool = False
    sweep_detected: bool = False
    active_order_blocks: list[OrderBlock] = field(default_factory=list)
    fvg_zones: list[FVGZone] = field(default_factory=list)
    distance_to_key_zone_pct: float = 1.0
    premium_discount: str = "equilibrium"  # "premium" | "discount" | "equilibrium"
    swing_high: float = 0.0
    swing_low: float = 0.0
    sk_sequence_stage: str = "none"
    sk_in_zone: bool = False
    sk_score: float = 0.0


# ─── Liquidity State ─────────────────────────────────────────────────────────


@dataclass
class LiquidityState:
    equal_highs_nearby: bool = False
    equal_lows_nearby: bool = False
    resting_liquidity_above: float = 0.0
    resting_liquidity_below: float = 0.0
    stop_hunt_probability: float = 0.0
    nearest_liquidity_pool_above: float = 0.0
    nearest_liquidity_pool_below: float = 0.0


# ─── Event Context ────────────────────────────────────────────────────────────


@dataclass
class EventContext:
    earnings_near: bool = False
    earnings_days_away: Optional[int] = None
    news_heat: float = 0.0
    macro_pressure: str = "neutral"  # "supportive" | "neutral" | "hostile"
    sector_alignment: float = 0.0  # -1 to 1
    vix_regime: str = "normal"  # "low" | "normal" | "elevated" | "extreme"
    fed_proximity: bool = False
    market_session: MarketSession = MarketSession.CLOSED
    session_quality: float = 0.5


# ─── Memory Cluster ──────────────────────────────────────────────────────────


@dataclass
class MemoryCluster:
    setup_family: SetupFamily = SetupFamily.SWEEP_RECLAIM
    regime: Regime = Regime.RANGING
    sample_count: int = 0
    win_rate: float = 0.0
    profit_factor: float = 0.0
    avg_r_multiple: float = 0.0
    best_sessions: list[MarketSession] = field(default_factory=list)
    avg_hold_bars: int = 0
    decay_score: float = 1.0
    last_updated: str = ""


# ─── Symbol Personality ───────────────────────────────────────────────────────


@dataclass
class SymbolPersonality:
    trendiness: float = 0.5
    mean_reversion: float = 0.5
    news_sensitivity: float = 0.5
    sweep_reaction: float = 0.5
    best_timeframe: Timeframe = Timeframe.M5
    best_session: MarketSession = MarketSession.NEW_YORK
    best_setup: SetupFamily = SetupFamily.SWEEP_RECLAIM


# ─── Recent Outcome ──────────────────────────────────────────────────────────


@dataclass
class RecentOutcome:
    setup: SetupFamily = SetupFamily.SWEEP_RECLAIM
    outcome: str = "loss"  # "win" | "loss" | "breakeven"
    r_multiple: float = 0.0
    timestamp: str = ""


# ─── Memory State ─────────────────────────────────────────────────────────────


@dataclass
class MemoryState:
    closest_setup_cluster: Optional[SetupFamily] = None
    cluster_similarity: float = 0.0
    cluster_win_rate: float = 0.0
    cluster_profit_factor: float = 0.0
    similar_cases_count: int = 0
    personality: SymbolPersonality = field(default_factory=SymbolPersonality)
    recent_outcomes: list[RecentOutcome] = field(default_factory=list)
    clusters: list[MemoryCluster] = field(default_factory=list)


# ─── Decision ─────────────────────────────────────────────────────────────────


@dataclass
class Decision:
    state: BrainState = BrainState.SCANNING
    confidence: float = 0.0
    setup_name: Optional[str] = None
    setup_family: Optional[SetupFamily] = None
    entry_quality: float = 0.0
    direction: Optional[str] = None  # "long" | "short"
    entry_price: Optional[float] = None
    stop_loss: Optional[float] = None
    take_profit: Optional[float] = None
    position_size: Optional[float] = None
    conditions_to_trigger: list[str] = field(default_factory=list)
    conditions_to_block: list[str] = field(default_factory=list)
    reasoning_summary: str = ""
    risk_approved: bool = False
    last_updated: str = ""


# ─── Reasoning Verdict (Claude Output) ────────────────────────────────────────


@dataclass
class ReasoningVerdict:
    verdict: str = "no_trade"  # strong_long | watch_long | neutral | watch_short | strong_short | no_trade
    confidence: float = 0.0
    reason: str = ""
    key_factors: list[str] = field(default_factory=list)
    contradictions: list[str] = field(default_factory=list)
    conditions_to_trigger: list[str] = field(default_factory=list)
    conditions_to_block: list[str] = field(default_factory=list)
    scenario_ranking: list[dict] = field(default_factory=list)
    memory_comparison: str = ""
    risk_assessment: str = ""
    latency_ms: float = 0.0
    computed_at: str = ""


# ─── Risk Gate ────────────────────────────────────────────────────────────────


@dataclass
class RiskGate:
    tradeable: bool = False
    reason: str = "No active setup"
    max_position_size_usd: float = 0.0
    max_loss_usd: float = 0.0
    stop_distance_atr: float = 1.5
    reward_risk_ratio: float = 0.0
    portfolio_heat_pct: float = 0.0
    daily_loss_remaining_pct: float = 100.0
    correlation_check: bool = True
    slippage_estimate_pct: float = 0.0


# ─── Evolution Metrics ────────────────────────────────────────────────────────


@dataclass
class EvolutionMetrics:
    total_trades: int = 0
    win_rate_7d: float = 0.0
    win_rate_30d: float = 0.0
    profit_factor_7d: float = 0.0
    profit_factor_30d: float = 0.0
    avg_r_multiple: float = 0.0
    best_performing_node: str = ""
    worst_performing_node: str = ""
    confidence_calibration: float = 0.5
    decay_alerts: list[str] = field(default_factory=list)
    threshold_adjustments: list[dict] = field(default_factory=list)
    last_evolution_run: str = ""


# ─── Complete Stock Brain State ───────────────────────────────────────────────


@dataclass
class StockBrainState:
    symbol: str = ""
    display_name: str = ""
    asset_class: str = "crypto"  # "crypto" | "equity" | "futures" | "forex"
    market_status: str = "closed"

    # Attention
    attention_level: Attention = Attention.LOW
    attention_score: float = 0.0
    compute_priority: int = 1

    # Core states
    price: PriceState = field(default_factory=PriceState)
    ticks: TickState = field(default_factory=TickState)
    order_flow: OrderFlowState = field(default_factory=OrderFlowState)
    structure: StructureState = field(default_factory=StructureState)
    liquidity: LiquidityState = field(default_factory=LiquidityState)
    event_context: EventContext = field(default_factory=EventContext)
    memory: MemoryState = field(default_factory=MemoryState)
    decision: Decision = field(default_factory=Decision)

    # Multi-timeframe
    timeframe_opinions: dict[str, TimeframeOpinion] = field(default_factory=dict)

    # Reasoning
    last_reasoning: Optional[ReasoningVerdict] = None
    risk_gate: RiskGate = field(default_factory=RiskGate)

    # Health
    node_health: NodeHealth = NodeHealth.INITIALIZING
    data_freshness_ms: float = 0.0
    last_full_update: str = ""
    error: Optional[str] = None


# ─── Supreme Brain State ─────────────────────────────────────────────────────


@dataclass
class SupremeBrainState:
    market_regime: Regime = Regime.RANGING
    market_regime_confidence: float = 0.0
    risk_appetite: str = "normal"  # "aggressive" | "normal" | "defensive" | "risk_off"
    portfolio_heat_pct: float = 0.0
    total_equity: float = 0.0
    daily_pnl: float = 0.0
    daily_pnl_pct: float = 0.0
    active_symbols: list[str] = field(default_factory=list)
    symbol_rankings: list[dict] = field(default_factory=list)
    max_concurrent_positions: int = 3
    current_positions: int = 0
    available_capital_pct: float = 100.0
    macro_context: EventContext = field(default_factory=EventContext)
    vix_level: float = 0.0
    market_breadth: float = 0.0
    evolution: EvolutionMetrics = field(default_factory=EvolutionMetrics)
    total_nodes_active: int = 0
    total_nodes_degraded: int = 0
    system_health: str = "healthy"
    last_update: str = ""


# ─── Consciousness Board ─────────────────────────────────────────────────────


@dataclass
class ConsciousnessCard:
    symbol: str = ""
    attention: str = "LOW"
    bias: str = "neutral"
    setup: str = "—"
    memory_match_pct: float = 0.0
    readiness_pct: float = 0.0
    risk_state: str = "Blocked"
    brain_verdict: str = "No active analysis"
    c4_score: float = 0.0
    regime: str = "ranging"
    node_health: str = "initializing"


# ─── Adaptive Rules ──────────────────────────────────────────────────────────


@dataclass
class AdaptiveRule:
    setup_family: str = ""
    min_structure_score: float = 0.65
    min_orderflow_score: float = 0.60
    min_memory_alignment: float = 0.50
    blocked_during_high_news_heat: bool = True
    best_sessions: list[str] = field(default_factory=lambda: ["new_york", "power_hour"])
    max_atr_pct: float = 0.05
    min_confidence: float = 0.60
    min_rr: float = 1.5
    max_risk_pct: float = 2.0
    enabled: bool = True
    cooldown_bars: int = 10
    last_adjusted: str = ""


DEFAULT_ADAPTIVE_RULES: dict[str, AdaptiveRule] = {
    sf.value: AdaptiveRule() for sf in SetupFamily
}
