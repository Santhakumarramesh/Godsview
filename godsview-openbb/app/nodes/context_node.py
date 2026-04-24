from __future__ import annotations

from typing import Any

from app.state.schemas import MarketSession, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


def _session_from_label(label: str) -> MarketSession:
    key = label.strip().lower()
    if key in {"new_york", "ny"}:
        return MarketSession.NEW_YORK
    if key in {"london"}:
        return MarketSession.LONDON
    if key in {"asia"}:
        return MarketSession.ASIA
    if key in {"power_hour"}:
        return MarketSession.POWER_HOUR
    if key in {"premarket"}:
        return MarketSession.PREMARKET
    if key in {"after_hours"}:
        return MarketSession.AFTER_HOURS
    return MarketSession.CLOSED


class ContextNode(NodeBase):
    name = "context_node"

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        data = payload.get("data", payload)
        session = data.get("session", {}) if isinstance(data, dict) else {}
        sentiment = data.get("sentiment", {}) if isinstance(data, dict) else {}
        macro = data.get("macro", {}) if isinstance(data, dict) else {}
        hard_gates = data.get("hard_gates", {}) if isinstance(data, dict) else {}

        ctx = brain.event_context
        ctx.market_session = _session_from_label(str(session.get("session", "closed")))
        ctx.session_quality = max(0.0, min(1.0, float(hard_gates.get("pass_ratio", 0.0))))
        ctx.news_heat = max(0.0, min(1.0, abs(float(sentiment.get("sentiment_score", 0.0)))))
        ctx.macro_pressure = "hostile" if bool(macro.get("blackout", False)) else "neutral"
        ctx.fed_proximity = bool(macro.get("blackout", False))
        ctx.earnings_near = bool(macro.get("blackout", False))
        self.mark_live(brain)
        return brain

