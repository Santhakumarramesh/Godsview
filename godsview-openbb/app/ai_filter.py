from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class FilterDecision:
    approved: bool
    final_action: str
    reasons: list[str]


def ai_trade_filter(signal: dict[str, Any], context: dict[str, Any]) -> FilterDecision:
    action = str(signal.get("action", "skip")).lower()
    prob_up = float(signal.get("prob_up", 0.5))

    reasons: list[str] = []
    if context.get("major_news_window", False):
        reasons.append("blocked: major_news_window")
    if context.get("spread_too_wide", False):
        reasons.append("blocked: spread_too_wide")
    if context.get("high_volatility", False):
        reasons.append("blocked: high_volatility")
    if context.get("degraded_data", False):
        reasons.append("blocked: degraded_data")

    if reasons:
        return FilterDecision(
            approved=False,
            final_action="skip",
            reasons=reasons,
        )

    if action == "skip":
        return FilterDecision(
            approved=False,
            final_action="skip",
            reasons=[f"neutral_model_probability: {prob_up:.4f}"],
        )

    return FilterDecision(
        approved=True,
        final_action=action,
        reasons=[f"model_confidence_ok: {prob_up:.4f}"],
    )
