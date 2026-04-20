"""Deterministic risk evaluator — no I/O, plain data in, verdict out.

The gate encapsulates every risk rule the live path enforces. Callers
pre-load state (budget, equity snapshot, open positions, pending
trade) and hand it to :func:`evaluate_risk`. The function returns a
:class:`RiskVerdict` with a single enumerated reason — first failing
rule wins.

Rule order (first failure wins — matches execution gate style):

  1. stale equity snapshot — equity must be < ``MAX_EQUITY_STALENESS_S``
     old; otherwise we refuse to evaluate to avoid size-on-wrong-number.
  2. risk budget missing — callers MUST pass a concrete budget.
  3. daily drawdown cap — if realised + pending loss ≥ budget.max_daily_drawdown_r
     * start_of_day_equity, reject.
  4. open-position cap — if we're already at or past
     budget.max_open_positions, reject.
  5. gross exposure cap — if (current_notional + pending_notional) /
     equity ≥ budget.max_gross_exposure, reject.
  6. correlation cap — per correlation class.
  7. per-trade risk cap — R-risk on this trade > budget.max_risk_per_trade_r.
  8. insufficient buying power — pending notional > equity.buying_power.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from typing import Literal


# ── knobs ───────────────────────────────────────────────────────────

#: An equity snapshot older than this cannot be used for risk math.
#: Operator-overridable via system-config later; frozen here for
#: determinism in PR4.
MAX_EQUITY_STALENESS_S: int = 60


RiskReason = Literal[
    "approved",
    "risk_budget_missing",
    "stale_equity_snapshot",
    "daily_drawdown_breached",
    "max_open_positions_breached",
    "gross_exposure_breached",
    "correlation_cap_breached",
    "risk_per_trade_breached",
    "insufficient_buying_power",
]


@dataclass(frozen=True, slots=True)
class RiskBudget:
    """Per-account risk envelope — mirrors the ``risk_budgets`` row."""

    max_risk_per_trade_r: float = 0.005
    max_daily_drawdown_r: float = 0.03
    max_open_positions: int = 5
    max_correlated_exposure: float = 1.0
    max_gross_exposure: float = 2.0


#: Conservative defaults — used when no row has been written yet.
DEFAULT_RISK_BUDGET: RiskBudget = RiskBudget()


@dataclass(frozen=True, slots=True)
class EquitySnapshot:
    """Point-in-time broker equity + derived P&L.

    ``realized_pnl`` is today's realised P&L in dollars; negative when
    the account is in drawdown. ``observed_at`` must be ``tz-aware``.
    """

    total_equity: float
    start_of_day_equity: float
    realized_pnl: float
    unrealized_pnl: float
    buying_power: float
    observed_at: datetime


@dataclass(frozen=True, slots=True)
class OpenPositionSummary:
    """One row per open position — the evaluator only needs these fields."""

    symbol: str
    correlation_class: str  # e.g. "us_tech", "crypto", "forex_major"
    notional: float  # abs(qty) * mark_price


@dataclass(frozen=True, slots=True)
class PendingTrade:
    """The trade we're evaluating right now."""

    symbol: str
    correlation_class: str
    direction: Literal["long", "short"]
    qty: float
    entry_price: float
    stop_loss: float
    # Optional free-form note — flows into audit only.
    note: str | None = None

    @property
    def notional(self) -> float:
        return abs(self.qty) * max(self.entry_price, 0.0)

    @property
    def dollar_risk(self) -> float:
        """Distance-to-stop * qty — the absolute dollar risk on fill."""

        distance = abs(self.entry_price - self.stop_loss)
        return abs(self.qty) * distance


@dataclass(frozen=True, slots=True)
class RiskInput:
    """Everything the evaluator needs to decide."""

    budget: RiskBudget | None
    equity: EquitySnapshot | None
    positions: tuple[OpenPositionSummary, ...] = field(default_factory=tuple)
    pending: PendingTrade | None = None
    now: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass(frozen=True, slots=True)
class RiskVerdict:
    approved: bool
    reason: RiskReason
    detail: str = ""
    # When approved, helper carries the sizing math in case the caller
    # wants to surface it in the UI.
    r_risk: float | None = None

    @classmethod
    def approve(cls, *, detail: str = "", r_risk: float | None = None) -> "RiskVerdict":
        return cls(approved=True, reason="approved", detail=detail, r_risk=r_risk)

    @classmethod
    def reject(cls, reason: RiskReason, detail: str = "") -> "RiskVerdict":
        return cls(approved=False, reason=reason, detail=detail)


# ── evaluator ──────────────────────────────────────────────────────


def evaluate_risk(ri: RiskInput) -> RiskVerdict:
    """Apply the deterministic risk floor.

    Order matters — first failing rule wins so ``detail`` always carries
    the number that tripped the gate.
    """

    if ri.budget is None:
        return RiskVerdict.reject(
            "risk_budget_missing",
            detail="no risk budget configured for this account",
        )
    if ri.equity is None:
        return RiskVerdict.reject(
            "stale_equity_snapshot",
            detail="no equity snapshot available",
        )

    # 1. snapshot must be fresh.
    observed = _ensure_aware(ri.equity.observed_at)
    now = _ensure_aware(ri.now)
    age_s = (now - observed).total_seconds()
    if age_s > MAX_EQUITY_STALENESS_S:
        return RiskVerdict.reject(
            "stale_equity_snapshot",
            detail=(
                f"equity snapshot is {age_s:.0f}s old "
                f"(> {MAX_EQUITY_STALENESS_S}s limit)"
            ),
        )

    budget = ri.budget
    equity = ri.equity
    pending = ri.pending

    # 2. daily drawdown cap.
    sod = equity.start_of_day_equity
    if sod > 0:
        current_drawdown_r = max(0.0, -(equity.realized_pnl + equity.unrealized_pnl)) / sod
        pending_loss_r = 0.0
        if pending is not None and sod > 0:
            pending_loss_r = pending.dollar_risk / sod
        projected = current_drawdown_r + pending_loss_r
        if projected >= budget.max_daily_drawdown_r:
            return RiskVerdict.reject(
                "daily_drawdown_breached",
                detail=(
                    f"projected drawdown {projected:.4f} >= "
                    f"cap {budget.max_daily_drawdown_r:.4f}"
                ),
            )

    # 3. open-position cap.
    open_count = len(ri.positions)
    if open_count >= budget.max_open_positions:
        return RiskVerdict.reject(
            "max_open_positions_breached",
            detail=(
                f"{open_count} open positions >= cap "
                f"{budget.max_open_positions}"
            ),
        )

    if pending is None:
        # Budget / equity / count checks all pass; no trade to size.
        return RiskVerdict.approve(
            detail=(
                f"preflight ok (open={open_count}, "
                f"draw={_compute_drawdown(equity):.4f})"
            )
        )

    # 4. gross exposure cap.
    equity_total = max(equity.total_equity, 1e-9)
    current_notional = sum(p.notional for p in ri.positions)
    projected_gross = (current_notional + pending.notional) / equity_total
    if projected_gross > budget.max_gross_exposure:
        return RiskVerdict.reject(
            "gross_exposure_breached",
            detail=(
                f"projected gross {projected_gross:.3f} > "
                f"cap {budget.max_gross_exposure:.3f}"
            ),
        )

    # 5. correlation cap.
    same_class = sum(
        p.notional
        for p in ri.positions
        if p.correlation_class == pending.correlation_class
    )
    projected_corr = (same_class + pending.notional) / equity_total
    if projected_corr > budget.max_correlated_exposure:
        return RiskVerdict.reject(
            "correlation_cap_breached",
            detail=(
                f"projected exposure in class "
                f"'{pending.correlation_class}' = {projected_corr:.3f} > "
                f"cap {budget.max_correlated_exposure:.3f}"
            ),
        )

    # 6. per-trade risk cap.
    r_risk = pending.dollar_risk / equity_total
    if r_risk > budget.max_risk_per_trade_r:
        return RiskVerdict.reject(
            "risk_per_trade_breached",
            detail=(
                f"trade R-risk {r_risk:.4f} > "
                f"cap {budget.max_risk_per_trade_r:.4f}"
            ),
        )

    # 7. buying power.
    if pending.notional > equity.buying_power:
        return RiskVerdict.reject(
            "insufficient_buying_power",
            detail=(
                f"notional {pending.notional:.2f} > "
                f"buying_power {equity.buying_power:.2f}"
            ),
        )

    return RiskVerdict.approve(
        detail=(
            f"passed (r_risk={r_risk:.4f}, "
            f"gross={projected_gross:.3f}, "
            f"corr={projected_corr:.3f})"
        ),
        r_risk=r_risk,
    )


# ── helpers ────────────────────────────────────────────────────────


def _ensure_aware(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _compute_drawdown(equity: EquitySnapshot) -> float:
    sod = max(equity.start_of_day_equity, 1e-9)
    return max(0.0, -(equity.realized_pnl + equity.unrealized_pnl)) / sod
