from __future__ import annotations

from typing import Any

from app.config import settings
from app.risk import apply_risk_checks
from app.state.schemas import BrainState, RiskGate, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase


class RiskNode(NodeBase):
    name = "risk_node"

    def run(self, brain: StockBrainState, payload: dict[str, Any], store: BrainStore) -> StockBrainState:
        data = payload.get("data", payload)
        signal = data.get("signal", {}) if isinstance(data, dict) else {}
        market = data.get("market", {}) if isinstance(data, dict) else {}
        blocked = bool(payload.get("blocked", False))

        entry_price = float(signal.get("close_price", market.get("last_price", brain.price.last or 0.0)))
        direction = brain.decision.direction
        if entry_price <= 0 or direction not in {"long", "short"} or blocked:
            brain.risk_gate = RiskGate(
                tradeable=False,
                reason="blocked_or_no_direction",
                max_position_size_usd=0.0,
                max_loss_usd=0.0,
                reward_risk_ratio=0.0,
                portfolio_heat_pct=0.0,
                daily_loss_remaining_pct=100.0,
            )
            brain.decision.risk_approved = False
            brain.decision.state = BrainState.BLOCKED if blocked else BrainState.WATCHING
            self.mark_live(brain)
            return brain

        stop_price = entry_price * (1.0 - settings.default_stop_pct)
        if direction == "short":
            stop_price = entry_price * (1.0 + settings.default_stop_pct)
        decision = apply_risk_checks(
            day_pnl_pct=0.0,
            max_daily_loss_pct=settings.max_daily_loss,
            account_equity=10_000.0,
            entry_price=entry_price,
            stop_price=stop_price,
            max_risk_pct=settings.max_risk_per_trade,
        )

        risk_dollars = abs(entry_price - stop_price) * decision.qty
        rr = max(settings.min_rr, 1.5)
        brain.risk_gate = RiskGate(
            tradeable=decision.allowed,
            reason=decision.reason,
            max_position_size_usd=float(decision.qty * entry_price),
            max_loss_usd=float(risk_dollars),
            stop_distance_atr=max(0.1, settings.default_stop_pct / max(brain.price.atr_pct, 1e-6)),
            reward_risk_ratio=rr,
            portfolio_heat_pct=min(100.0, (risk_dollars / 10_000.0) * 100),
            daily_loss_remaining_pct=100.0,
            slippage_estimate_pct=max(0.0, min(0.02, brain.price.spread_pct)),
        )
        brain.decision.risk_approved = decision.allowed
        if not decision.allowed:
            brain.decision.state = BrainState.BLOCKED
        self.mark_live(brain)
        return brain

