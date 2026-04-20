"""Risk engine — pure deterministic safety layer for live execution.

The risk engine enforces five caps on every live-gate request:

  * ``max_risk_per_trade_r``      — fraction of equity at risk on this trade
  * ``max_daily_drawdown_r``      — fraction of start-of-day equity already lost
  * ``max_open_positions``        — global open-position ceiling
  * ``max_gross_exposure``        — sum of position notional / equity
  * ``max_correlated_exposure``   — exposure in the same correlation class

Every function in this package is synchronous, side-effect-free, and
takes plain data — the route layer loads state from the DB, passes it
to :func:`evaluate_risk`, and translates the result into either an
approval or a typed 4xx.

Exports
-------

* :func:`evaluate_risk` — the single deterministic decision function
* :class:`RiskInput`    — snapshot of equity + positions + pending trade
* :class:`RiskVerdict`  — enumerated verdict + human-readable detail
* :func:`size_for_trade` — position-size calculator (risk_per_trade_r)
"""

from app.risk.evaluator import (
    DEFAULT_RISK_BUDGET,
    EquitySnapshot,
    OpenPositionSummary,
    PendingTrade,
    RiskBudget,
    RiskInput,
    RiskReason,
    RiskVerdict,
    evaluate_risk,
)
from app.risk.sizing import (
    SizingError,
    size_for_trade,
)

__all__ = [
    "DEFAULT_RISK_BUDGET",
    "EquitySnapshot",
    "OpenPositionSummary",
    "PendingTrade",
    "RiskBudget",
    "RiskInput",
    "RiskReason",
    "RiskVerdict",
    "SizingError",
    "evaluate_risk",
    "size_for_trade",
]
