from __future__ import annotations

from typing import Any

from app.config import settings


def classify_strategy_state(metrics: dict[str, Any]) -> dict[str, Any]:
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

