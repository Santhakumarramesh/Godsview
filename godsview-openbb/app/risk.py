from __future__ import annotations

from dataclasses import dataclass


@dataclass(frozen=True)
class RiskDecision:
    allowed: bool
    reason: str
    qty: int


def position_size(
    account_equity: float,
    entry_price: float,
    stop_price: float,
    max_risk_pct: float,
) -> int:
    risk_dollars = account_equity * abs(max_risk_pct)
    per_unit_risk = abs(entry_price - stop_price)
    if per_unit_risk <= 0:
        return 0
    qty = int(risk_dollars / per_unit_risk)
    return max(qty, 0)


def allowed_to_trade(
    day_pnl_pct: float,
    max_daily_loss_pct: float,
) -> bool:
    return day_pnl_pct > -abs(max_daily_loss_pct)


def apply_risk_checks(
    *,
    day_pnl_pct: float,
    max_daily_loss_pct: float,
    account_equity: float,
    entry_price: float,
    stop_price: float,
    max_risk_pct: float,
) -> RiskDecision:
    if not allowed_to_trade(day_pnl_pct, max_daily_loss_pct):
        return RiskDecision(allowed=False, reason="daily_loss_limit_hit", qty=0)

    qty = position_size(
        account_equity=account_equity,
        entry_price=entry_price,
        stop_price=stop_price,
        max_risk_pct=max_risk_pct,
    )
    if qty <= 0:
        return RiskDecision(allowed=False, reason="invalid_position_size", qty=0)

    return RiskDecision(allowed=True, reason="ok", qty=qty)
