from __future__ import annotations

import time
from typing import Any

from app.agents.base import Agent, AgentState
from app.config import settings
from app.data.stack import get_macro_context


class MacroAgent(Agent):
    """
    Macro Context Agent - fetches macroeconomic indicators and regime assessment.

    Uses FRED API (interest rates, VIX, DXY), earnings calendar, and economic calendar.
    Returns macro assessment including regime, VIX level, rate trend, earnings window.
    Gracefully falls back if API keys not available.
    """

    name = "macro_agent"

    def run(self, state: AgentState) -> AgentState:
        """
        Evaluate macro context and update state with macro assessment.

        Args:
            state: Current agent state

        Returns:
            Updated agent state with macro data
        """
        if state.blocked:
            return state

        try:
            start_time = time.time()

            # Fetch macro context (already exists in data_agent, but we're independent)
            macro_context = get_macro_context(state.symbol)

            # Extract key macro indicators
            vix_level = float(macro_context.get("vix", 15.0))
            fed_rate = float(macro_context.get("fed_funds_rate", 0.0))
            dxy_price = float(macro_context.get("dxy", 100.0))
            earnings_window = bool(macro_context.get("earnings_window", False))
            blackout = bool(macro_context.get("blackout", False))

            # Assess regime based on VIX and rate environment
            regime = self._assess_regime(vix_level, fed_rate)

            # Rate trend assessment
            rate_trend = self._assess_rate_trend(fed_rate)

            # Macro score (0-1): higher = more favorable
            macro_score = self._compute_macro_score(
                vix_level=vix_level,
                fed_rate=fed_rate,
                dxy=dxy_price,
                earnings_window=earnings_window,
                blackout=blackout,
            )

            macro_assessment = {
                "regime": regime,
                "vix_level": float(vix_level),
                "fed_rate": float(fed_rate),
                "dxy": float(dxy_price),
                "rate_trend": rate_trend,
                "earnings_window": earnings_window,
                "blackout": blackout,
                "macro_score": float(macro_score),
                "elapsed_ms": int((time.time() - start_time) * 1000),
            }

            state.data["macro_agent"] = macro_assessment
            return state

        except Exception as err:  # noqa: BLE001
            state.add_error(f"macro_agent_error: {err}")
            # Graceful degradation: return neutral assessment
            state.data["macro_agent"] = {
                "regime": "neutral",
                "vix_level": 15.0,
                "fed_rate": 0.0,
                "dxy": 100.0,
                "rate_trend": "neutral",
                "earnings_window": False,
                "blackout": False,
                "macro_score": 0.5,
                "error": str(err),
            }
            return state

    @staticmethod
    def _assess_regime(vix: float, fed_rate: float) -> str:
        """
        Assess macro regime based on VIX and fed funds rate.

        Args:
            vix: VIX index level
            fed_rate: Federal funds rate (%)

        Returns:
            Regime: 'risk_on', 'risk_off', or 'neutral'
        """
        if vix > 25.0:
            return "risk_off"
        if vix < 15.0 and fed_rate < 4.0:
            return "risk_on"
        return "neutral"

    @staticmethod
    def _assess_rate_trend(fed_rate: float) -> str:
        """
        Assess fed funds rate trend direction.

        Args:
            fed_rate: Federal funds rate (%)

        Returns:
            Trend: 'rising', 'falling', or 'neutral'
        """
        # Simplified: would normally track rate history
        if fed_rate > 4.5:
            return "rising"
        if fed_rate < 2.0:
            return "falling"
        return "neutral"

    @staticmethod
    def _compute_macro_score(
        *,
        vix_level: float,
        fed_rate: float,
        dxy: float,
        earnings_window: bool,
        blackout: bool,
    ) -> float:
        """
        Compute macro favorability score (0-1).

        Higher score = more favorable macro environment for trading.

        Args:
            vix_level: VIX index
            fed_rate: Federal funds rate
            dxy: US Dollar Index
            earnings_window: Whether in earnings season
            blackout: Whether in macro blackout window

        Returns:
            Macro score (0-1)
        """
        score = 0.5  # Neutral baseline

        # VIX component: lower is better
        if vix_level < 12.0:
            score += 0.15
        elif vix_level > 30.0:
            score -= 0.20

        # Fed rate component: moderate rates are favorable
        if 1.5 < fed_rate < 5.5:
            score += 0.10
        else:
            score -= 0.05

        # DXY component: weak dollar often favors risk assets
        if dxy < 95.0:
            score += 0.10
        elif dxy > 110.0:
            score -= 0.10

        # Earnings window: typically more volatile
        if earnings_window:
            score -= 0.05

        # Blackout: avoid trading
        if blackout:
            score -= 0.25

        return max(0.0, min(1.0, score))
