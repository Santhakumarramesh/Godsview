from __future__ import annotations

from typing import Any

from app.config import settings
from app.governance.engine import GovernanceEngine
from app.governance.trust_tiers import TrustTierLevel


def classify_strategy_state(metrics: dict[str, Any]) -> dict[str, Any]:
    """Legacy classification function for backward compatibility.

    This is superseded by the GovernanceEngine but kept for compatibility.
    Classifies strategy state as DISABLED/WEAK/ACTIVE based on metrics.

    Args:
        metrics: Dict with 'closed_trades', 'profit_factor', 'max_drawdown_pct',
                 'expectancy_r', 'win_rate'

    Returns:
        Dict with status, promotion_ready, reasons, metrics
    """
    trades = int(metrics.get("closed_trades", metrics.get("trades", 0)) or 0)
    pf = float(metrics.get("profit_factor", 0.0))
    dd = float(metrics.get("max_drawdown_pct", 0.0))
    expectancy_r = float(metrics.get("expectancy_r", 0.0))
    win_rate = float(metrics.get("win_rate", 0.0))

    reasons: list[str] = []
    if trades < 30:
        return {
            "status": "WEAK",
            "promotion_ready": False,
            "reasons": ["insufficient_sample_size"],
            "metrics": metrics,
        }

    promotion_ready = True
    if pf < settings.promotion_min_profit_factor:
        promotion_ready = False
        reasons.append("profit_factor_below_threshold")
    if dd > settings.promotion_max_drawdown_pct:
        promotion_ready = False
        reasons.append("drawdown_above_threshold")
    if expectancy_r < settings.promotion_min_expectancy_r:
        promotion_ready = False
        reasons.append("expectancy_below_threshold")
    if win_rate < settings.promotion_min_win_rate:
        promotion_ready = False
        reasons.append("win_rate_below_threshold")

    status = "ACTIVE" if promotion_ready else "WEAK"
    if pf < 1.1 or expectancy_r < 0 or dd > settings.promotion_max_drawdown_pct * 1.5:
        status = "DISABLED"
        promotion_ready = False
        if "critical_performance_decay" not in reasons:
            reasons.append("critical_performance_decay")

    if not reasons:
        reasons.append("all_thresholds_passed")

    return {
        "status": status,
        "promotion_ready": promotion_ready,
        "reasons": reasons,
        "metrics": metrics,
    }


def promote_to_tier(
    engine: GovernanceEngine,
    promotion_min_profit_factor: float = 1.5,
    promotion_min_win_rate: float = 0.4,
) -> dict[str, Any]:
    """Helper to promote engine tier when conditions are met.

    Args:
        engine: GovernanceEngine instance
        promotion_min_profit_factor: Minimum profit factor
        promotion_min_win_rate: Minimum win rate

    Returns:
        Promotion result dict
    """
    current_tier = engine.current_tier
    # Promote one tier if conditions met
    if current_tier.value < 4:  # Can't promote beyond TIER_4_AUTONOMOUS
        new_tier = TrustTierLevel(current_tier.value + 1)
        return engine.promote_or_demote_tier(
            new_tier=new_tier,
            reason="performance_promotion",
            triggered_by="performance_monitor",
        )
    return {"changed": False, "reason": "already_at_max_tier"}

