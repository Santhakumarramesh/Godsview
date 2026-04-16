from __future__ import annotations

from typing import Any

import httpx

from app.config import settings
from app.risk import apply_risk_checks
from app.state.schemas import BrainState, RiskGate, StockBrainState
from app.state.store import BrainStore

from .base_node import NodeBase

# Try to import logger if available
try:
    from services.shared.logging import get_logger
    log = get_logger(__name__)
except Exception:
    log = None


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

        # ── Enhanced Risk Checks via Portfolio Intelligence ─────────────────────
        # Check correlation, sector concentration, and drawdown impact
        correlation_risk = self._check_correlation_risk(brain.symbol)
        sector_risk = self._check_sector_risk(brain.symbol)
        drawdown_impact = self._check_drawdown_impact()

        # Determine if trade should be approved based on portfolio health
        portfolio_tradeable = True
        portfolio_reason = ""
        if correlation_risk and correlation_risk.get("high_correlation"):
            portfolio_tradeable = False
            portfolio_reason = f"high_correlation_with_{correlation_risk.get('correlated_symbol')}"
        elif sector_risk and sector_risk.get("over_concentrated"):
            portfolio_tradeable = False
            portfolio_reason = "sector_over_concentrated"
        elif drawdown_impact and drawdown_impact.get("trading_halted"):
            portfolio_tradeable = False
            portfolio_reason = "drawdown_halt_active"

        # Combine portfolio health with baseline decision
        final_allowed = decision.allowed and portfolio_tradeable
        final_reason = portfolio_reason if not portfolio_tradeable else decision.reason

        brain.risk_gate = RiskGate(
            tradeable=final_allowed,
            reason=final_reason,
            max_position_size_usd=float(decision.qty * entry_price),
            max_loss_usd=float(risk_dollars),
            stop_distance_atr=max(0.1, settings.default_stop_pct / max(brain.price.atr_pct, 1e-6)),
            reward_risk_ratio=rr,
            portfolio_heat_pct=min(100.0, (risk_dollars / 10_000.0) * 100),
            daily_loss_remaining_pct=100.0,
            slippage_estimate_pct=max(0.0, min(0.02, brain.price.spread_pct)),
        )
        brain.decision.risk_approved = final_allowed
        if not final_allowed:
            brain.decision.state = BrainState.BLOCKED
        self.mark_live(brain)
        return brain

    def _check_correlation_risk(self, symbol: str) -> dict[str, Any]:
        """Check if new position is highly correlated with existing ones."""
        try:
            response = httpx.get(
                f"{settings.risk_url}/portfolio/correlation",
                timeout=2.0,
            )
            if response.status_code != 200:
                return {}

            data = response.json()
            dangerous_pairs = data.get("dangerous_pairs", [])

            for pair in dangerous_pairs:
                if pair.get("symbol_a") == symbol or pair.get("symbol_b") == symbol:
                    other = pair.get("symbol_b") if pair.get("symbol_a") == symbol else pair.get("symbol_a")
                    return {
                        "high_correlation": True,
                        "correlated_symbol": other,
                        "correlation": pair.get("correlation"),
                    }
            return {}
        except Exception as e:
            if log:
                log.warning(f"correlation_risk_check_failed: {e}")
            return {}

    def _check_sector_risk(self, symbol: str) -> dict[str, Any]:
        """Check if sector is over-concentrated."""
        try:
            response = httpx.get(
                f"{settings.risk_url}/portfolio/sectors",
                timeout=2.0,
            )
            if response.status_code != 200:
                return {}

            data = response.json()
            over_concentrated = data.get("over_concentrated", [])

            # If any sector is over 40%, flag it
            if over_concentrated:
                return {
                    "over_concentrated": True,
                    "sectors": over_concentrated,
                }
            return {}
        except Exception as e:
            if log:
                log.warning(f"sector_risk_check_failed: {e}")
            return {}

    def _check_drawdown_impact(self) -> dict[str, Any]:
        """Check current drawdown level and trading halt status."""
        try:
            response = httpx.get(
                f"{settings.risk_url}/portfolio/summary",
                timeout=2.0,
            )
            if response.status_code != 200:
                return {}

            data = response.json()
            summary = data.get("summary", {})

            return {
                "drawdown_pct": summary.get("drawdown_pct", 0.0),
                "trading_halted": summary.get("trading_halted", False),
                "position_size_multiplier": summary.get("position_size_multiplier", 1.0),
            }
        except Exception as e:
            if log:
                log.warning(f"drawdown_check_failed: {e}")
            return {}

