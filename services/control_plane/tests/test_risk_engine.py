"""Unit tests for the pure risk evaluator and sizing helper.

The evaluator is side-effect-free and takes plain data so every test
builds one RiskInput and asserts the exact RiskVerdict.reason plus
(on approve) the R-risk.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.risk import (
    DEFAULT_RISK_BUDGET,
    EquitySnapshot,
    OpenPositionSummary,
    PendingTrade,
    RiskBudget,
    RiskInput,
    SizingError,
    evaluate_risk,
    size_for_trade,
)

UTC = timezone.utc


def _equity(
    *,
    total: float = 100_000.0,
    sod: float = 100_000.0,
    realized: float = 0.0,
    unrealized: float = 0.0,
    buying_power: float = 400_000.0,
    observed_at: datetime | None = None,
) -> EquitySnapshot:
    return EquitySnapshot(
        total_equity=total,
        start_of_day_equity=sod,
        realized_pnl=realized,
        unrealized_pnl=unrealized,
        buying_power=buying_power,
        observed_at=observed_at or datetime.now(UTC),
    )


def _budget(**overrides: float | int) -> RiskBudget:
    params: dict = {
        "max_risk_per_trade_r": 0.005,
        "max_daily_drawdown_r": 0.03,
        "max_open_positions": 5,
        "max_correlated_exposure": 1.0,
        "max_gross_exposure": 2.0,
    }
    params.update(overrides)
    return RiskBudget(**params)  # type: ignore[arg-type]


def _pending(
    *,
    entry: float = 100.0,
    stop: float = 99.5,
    qty: float = 100.0,
    corr: str = "us_tech",
    symbol: str = "AAPL",
) -> PendingTrade:
    return PendingTrade(
        symbol=symbol,
        correlation_class=corr,
        direction="long",
        qty=qty,
        entry_price=entry,
        stop_loss=stop,
    )


# ── evaluator ─────────────────────────────────────────────────────


def test_missing_budget_rejects() -> None:
    ri = RiskInput(budget=None, equity=_equity(), pending=_pending())
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "risk_budget_missing"


def test_missing_equity_rejects() -> None:
    ri = RiskInput(budget=_budget(), equity=None, pending=_pending())
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "stale_equity_snapshot"


def test_stale_equity_rejects() -> None:
    now = datetime.now(UTC)
    stale = now - timedelta(minutes=5)
    ri = RiskInput(
        budget=_budget(),
        equity=_equity(observed_at=stale),
        pending=_pending(),
        now=now,
    )
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "stale_equity_snapshot"


def test_daily_drawdown_breached_rejects() -> None:
    """realized + unrealized ≈ -2.5% SoD, pending loss another 0.8% → cap 3% trips."""

    ri = RiskInput(
        budget=_budget(max_daily_drawdown_r=0.03, max_risk_per_trade_r=0.01),
        equity=_equity(realized=-2500.0, unrealized=0.0),
        pending=_pending(entry=100.0, stop=92.0, qty=100.0),  # $800 risk
    )
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "daily_drawdown_breached"


def test_max_open_positions_breached_rejects() -> None:
    positions = tuple(
        OpenPositionSummary(
            symbol=f"S{i}", correlation_class="us_tech", notional=1000.0
        )
        for i in range(5)
    )
    ri = RiskInput(
        budget=_budget(max_open_positions=5),
        equity=_equity(),
        positions=positions,
        pending=_pending(),
    )
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "max_open_positions_breached"


def test_gross_exposure_breached_rejects() -> None:
    # Budget allows 2x equity gross, equity=100k so cap=200k.
    # Existing 3 positions at 80k each = 240k > 200k even without pending.
    # But open-positions cap=5 so we fit 4 positions at 50k + pending 10k.
    positions = tuple(
        OpenPositionSummary(
            symbol=f"S{i}", correlation_class=f"class_{i}", notional=50_000.0
        )
        for i in range(4)
    )
    # pending notional: 100 shares * 100 price = 10k → gross = 210k > 200k
    ri = RiskInput(
        budget=_budget(max_gross_exposure=2.0, max_open_positions=10),
        equity=_equity(total=100_000.0),
        positions=positions,
        pending=_pending(entry=100.0, stop=99.5, qty=100.0),
    )
    # 4 * 50_000 + 10_000 = 210_000 > 200_000
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "gross_exposure_breached"


def test_correlation_cap_breached_rejects() -> None:
    """Max correlated exposure=0.5x, two us_tech positions already fill it."""

    positions = (
        OpenPositionSummary(
            symbol="AAPL", correlation_class="us_tech", notional=30_000.0
        ),
        OpenPositionSummary(
            symbol="MSFT", correlation_class="us_tech", notional=25_000.0
        ),
    )
    ri = RiskInput(
        budget=_budget(
            max_correlated_exposure=0.5, max_gross_exposure=5.0, max_open_positions=10
        ),
        equity=_equity(total=100_000.0),
        positions=positions,
        pending=_pending(symbol="NVDA", corr="us_tech", entry=100.0, stop=99.5, qty=100.0),
    )
    # 55_000 + 10_000 = 65_000 / 100_000 = 0.65 > 0.5
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "correlation_cap_breached"


def test_risk_per_trade_breached_rejects() -> None:
    """Budget 0.5% per trade = $500 max. Pending risks $1000."""

    ri = RiskInput(
        budget=_budget(max_risk_per_trade_r=0.005),
        equity=_equity(total=100_000.0),
        pending=_pending(entry=100.0, stop=90.0, qty=100.0),  # $1000 risk
    )
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "risk_per_trade_breached"


def test_insufficient_buying_power_rejects() -> None:
    ri = RiskInput(
        budget=_budget(
            max_risk_per_trade_r=0.1,  # relaxed so we hit BP cap instead
            max_daily_drawdown_r=0.5,
            max_gross_exposure=10.0,
            max_correlated_exposure=10.0,
        ),
        equity=_equity(total=100_000.0, buying_power=5_000.0),
        pending=_pending(entry=100.0, stop=99.5, qty=100.0),  # $10k notional
    )
    v = evaluate_risk(ri)
    assert v.approved is False
    assert v.reason == "insufficient_buying_power"


def test_happy_path_approves() -> None:
    ri = RiskInput(
        budget=DEFAULT_RISK_BUDGET,
        equity=_equity(total=100_000.0),
        positions=(),
        pending=_pending(entry=100.0, stop=99.75, qty=100.0),  # $25 risk = 0.025% R
    )
    v = evaluate_risk(ri)
    assert v.approved, v
    assert v.reason == "approved"
    assert v.r_risk is not None
    assert 0.0 < v.r_risk < 0.005


def test_preflight_no_pending_approves() -> None:
    """evaluate_risk with no pending trade is a preflight check only."""

    ri = RiskInput(
        budget=DEFAULT_RISK_BUDGET,
        equity=_equity(),
        positions=(),
        pending=None,
    )
    v = evaluate_risk(ri)
    assert v.approved
    assert v.r_risk is None


# ── sizing ───────────────────────────────────────────────────────


def test_size_for_trade_floors_to_lot_size() -> None:
    # 100k * 0.005 = $500 risk, stop_distance = 0.25 → 2000 raw qty
    qty = size_for_trade(
        equity=100_000.0,
        risk_per_trade_r=0.005,
        entry_price=100.0,
        stop_loss=99.75,
    )
    assert qty == 2000.0


def test_size_for_trade_exact_mode_returns_fraction() -> None:
    qty = size_for_trade(
        equity=100_000.0,
        risk_per_trade_r=0.005,
        entry_price=100.0,
        stop_loss=99.9,
        round_mode="exact",
    )
    # 500 / 0.1 = 5000 exactly — pick a ragged stop to test fractions
    qty2 = size_for_trade(
        equity=100_000.0,
        risk_per_trade_r=0.005,
        entry_price=100.0,
        stop_loss=99.77,
        round_mode="exact",
    )
    assert qty == pytest.approx(5000.0, rel=1e-9)
    assert qty2 == pytest.approx(500.0 / 0.23, rel=1e-9)


def test_size_for_trade_returns_zero_when_risk_too_small() -> None:
    qty = size_for_trade(
        equity=1_000.0,
        risk_per_trade_r=0.0001,  # $0.10 risk
        entry_price=100.0,
        stop_loss=90.0,  # $10 stop — qty ≈ 0.01 → floors to 0
        lot_size=1.0,
    )
    assert qty == 0.0


def test_size_for_trade_raises_on_zero_stop_distance() -> None:
    with pytest.raises(SizingError):
        size_for_trade(
            equity=100_000.0,
            risk_per_trade_r=0.005,
            entry_price=100.0,
            stop_loss=100.0,
        )


def test_size_for_trade_raises_on_negative_equity() -> None:
    with pytest.raises(SizingError):
        size_for_trade(
            equity=-1.0,
            risk_per_trade_r=0.005,
            entry_price=100.0,
            stop_loss=99.0,
        )
