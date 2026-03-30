"""
state/reducers.py — State Reducers

Pure functions that take (current_state, event) → new_state.
Used by the store to apply events immutably.

Keeps state transitions predictable and testable.
"""

from __future__ import annotations
from datetime import datetime, timezone
from typing import Optional

from .schemas import (
    StockBrainState, SupremeBrainState,
    BrainState, NodeHealth, Attention,
    Bias, Regime,
)


def reduce_price_update(brain: StockBrainState, payload: dict) -> StockBrainState:
    """Apply a price tick update to the brain."""
    brain.price.last = payload.get("price", brain.price.last)
    brain.price.bid = payload.get("bid", brain.price.bid)
    brain.price.ask = payload.get("ask", brain.price.ask)
    brain.price.spread_pct = payload.get("spread_pct", brain.price.spread_pct)
    brain.data_freshness_ms = payload.get("latency_ms", 0)
    return brain


def reduce_timeframe_opinion(brain: StockBrainState, tf: str, payload: dict) -> StockBrainState:
    """Apply a timeframe opinion update."""
    from .schemas import TimeframeOpinion, Timeframe
    opinion = TimeframeOpinion(
        timeframe=Timeframe(tf) if tf in [t.value for t in Timeframe] else Timeframe.M1,
        bias=Bias(payload.get("bias", "neutral")),
        confidence=payload.get("confidence", 0),
        regime=Regime(payload.get("regime", "ranging")),
        momentum=payload.get("momentum", 0),
        trend_strength=payload.get("trend_strength", 0),
    )
    brain.timeframe_opinions[tf] = opinion
    return brain


def reduce_structure_update(brain: StockBrainState, payload: dict) -> StockBrainState:
    """Apply structure node update."""
    s = brain.structure
    s.htf_bias = Bias(payload.get("htf_bias", s.htf_bias.value))
    s.itf_bias = Bias(payload.get("itf_bias", s.itf_bias.value))
    s.ltf_bias = Bias(payload.get("ltf_bias", s.ltf_bias.value))
    s.bos_count = payload.get("bos_count", s.bos_count)
    s.choch_detected = payload.get("choch_detected", s.choch_detected)
    s.sweep_detected = payload.get("sweep_detected", s.sweep_detected)
    s.sk_score = payload.get("sk_score", s.sk_score)
    return brain


def reduce_orderflow_update(brain: StockBrainState, payload: dict) -> StockBrainState:
    """Apply order flow node update."""
    of = brain.order_flow
    of.delta_score = payload.get("delta_score", of.delta_score)
    of.cvd_trend = payload.get("cvd_trend", of.cvd_trend)
    of.absorption_score = payload.get("absorption_score", of.absorption_score)
    of.imbalance_score = payload.get("imbalance_score", of.imbalance_score)
    of.buy_volume_ratio = payload.get("buy_volume_ratio", of.buy_volume_ratio)
    return brain


def reduce_reasoning_verdict(brain: StockBrainState, payload: dict) -> StockBrainState:
    """Apply reasoning verdict."""
    from .schemas import ReasoningVerdict
    brain.last_reasoning = ReasoningVerdict(
        verdict=payload.get("verdict", "no_trade"),
        confidence=payload.get("confidence", 0),
        reason=payload.get("reason", ""),
        key_factors=payload.get("key_factors", []),
        contradictions=payload.get("contradictions", []),
        conditions_to_trigger=payload.get("conditions_to_trigger", []),
        conditions_to_block=payload.get("conditions_to_block", []),
        scenario_ranking=payload.get("scenario_ranking", []),
        computed_at=datetime.now(timezone.utc).isoformat(),
    )
    return brain


def reduce_risk_gate(brain: StockBrainState, payload: dict) -> StockBrainState:
    """Apply risk gate evaluation."""
    from .schemas import RiskGate
    brain.risk_gate = RiskGate(
        tradeable=payload.get("tradeable", False),
        reason=payload.get("reason", ""),
        max_position_size_usd=payload.get("max_position_size_usd", 0),
        max_loss_usd=payload.get("max_loss_usd", 0),
        reward_risk_ratio=payload.get("reward_risk_ratio", 0),
        portfolio_heat_pct=payload.get("portfolio_heat_pct", 0),
    )
    brain.decision.risk_approved = brain.risk_gate.tradeable
    return brain


def reduce_decision_state(brain: StockBrainState, new_state: str) -> StockBrainState:
    """Transition the brain's decision state machine."""
    valid_transitions = {
        "scanning": ["watching", "scanning"],
        "watching": ["ready", "scanning"],
        "ready": ["entry_pending", "in_position", "scanning"],
        "entry_pending": ["in_position", "scanning"],
        "in_position": ["cooldown", "scanning"],
        "cooldown": ["scanning"],
        "blocked": ["scanning"],
    }
    current = brain.decision.state.value
    allowed = valid_transitions.get(current, ["scanning"])

    if new_state in allowed:
        brain.decision.state = BrainState(new_state)
        brain.decision.last_updated = datetime.now(timezone.utc).isoformat()
    return brain


def reduce_health_check(brain: StockBrainState) -> StockBrainState:
    """Derive node health from data freshness and state completeness."""
    if brain.data_freshness_ms > 30000:  # 30s stale
        brain.node_health = NodeHealth.DEGRADED
        brain.error = "Data stale"
    elif brain.error:
        brain.node_health = NodeHealth.OFFLINE
    elif brain.last_full_update:
        brain.node_health = NodeHealth.LIVE
        brain.error = None
    else:
        brain.node_health = NodeHealth.INITIALIZING
    return brain


# ─── Supreme Reducers ──────────────────────────────────────────────────────

def reduce_supreme_regime(supreme: SupremeBrainState, regime: str, confidence: float) -> SupremeBrainState:
    """Update supreme market regime."""
    supreme.market_regime = Regime(regime)
    supreme.market_regime_confidence = confidence
    return supreme


def reduce_supreme_pnl(supreme: SupremeBrainState, daily_pnl: float, equity: float) -> SupremeBrainState:
    """Update supreme PnL state."""
    supreme.daily_pnl = daily_pnl
    supreme.total_equity = equity
    if equity > 0:
        supreme.daily_pnl_pct = round((daily_pnl / equity) * 100, 3)
    return supreme
