"""Unit tests for the pure live execution gate.

Every rule in :func:`app.execution.live_gate.evaluate_live_gate` gets
a targeted negative test that pins the exact ``reason`` string, plus
one happy-path test that walks the full rule stack. The sizing preview
helper is tested separately because it's a pure projection, not a
decision.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.execution import (
    LiveGateDecision,
    LiveGateInput,
    evaluate_live_gate,
    preview_live_sizing,
)
from app.risk import EquitySnapshot, RiskBudget

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


def _make_input(**overrides) -> LiveGateInput:
    """Build a baseline *approvable* live gate input; tests tweak fields."""

    now = datetime.now(UTC)
    base: dict = {
        "mode": "live",
        "size_multiplier": 1.0,
        "setup_status": "detected",
        "setup_confidence": 0.72,
        "setup_expires_at": now + timedelta(hours=1),
        "setup_has_active_live_trade": False,
        "kill_switch_active": False,
        "active_trades_for_symbol": 0,
        "active_trades_global": 0,
        "live_enabled": True,
        "broker_available": True,
        "equity": _equity(),
        "risk": _budget(),
        "planned_trade_risk_dollars": 250.0,  # 0.25% R on 100k = under 0.5% cap
        "planned_trade_notional": 10_000.0,  # 10% gross — well under 2x cap
        "current_gross_exposure": 0.0,
        "correlated_gross_exposure": 0.0,
        "open_positions_count": 0,
        "equity_age_seconds": 5.0,
        "correlation_class": "us_tech",
        "now": now,
    }
    base.update(overrides)
    return LiveGateInput(**base)


# ── absolute overrides ─────────────────────────────────────────────


def test_kill_switch_beats_everything() -> None:
    d = evaluate_live_gate(_make_input(kill_switch_active=True))
    assert not d.approved
    assert d.reason == "kill_switch_active"


def test_live_disabled_rejects_in_live_mode() -> None:
    d = evaluate_live_gate(_make_input(live_enabled=False))
    assert d.reason == "live_disabled"


def test_broker_unavailable_rejects_in_live_mode() -> None:
    d = evaluate_live_gate(_make_input(broker_available=False))
    assert d.reason == "broker_unavailable"


def test_live_disabled_does_not_reject_paper_mode() -> None:
    """Paper mode does not need the live toggle."""
    d = evaluate_live_gate(
        _make_input(mode="paper", live_enabled=False, broker_available=False)
    )
    assert d.approved, d


# ── setup-state preconditions ──────────────────────────────────────


def test_setup_not_detected_rejects() -> None:
    d = evaluate_live_gate(_make_input(setup_status="approved_paper"))
    assert d.reason == "setup_not_detected"


def test_duplicate_active_live_trade_rejects() -> None:
    d = evaluate_live_gate(_make_input(setup_has_active_live_trade=True))
    assert d.reason == "duplicate_active_trade"


def test_setup_expired_rejects() -> None:
    now = datetime.now(UTC)
    d = evaluate_live_gate(
        _make_input(setup_expires_at=now - timedelta(seconds=1), now=now)
    )
    assert d.reason == "setup_expired"


def test_setup_expiry_null_is_ok() -> None:
    d = evaluate_live_gate(_make_input(setup_expires_at=None))
    assert d.approved


# ── sizing + confidence ────────────────────────────────────────────


def test_size_multiplier_zero_rejects() -> None:
    d = evaluate_live_gate(_make_input(size_multiplier=0.0))
    assert d.reason == "size_multiplier_out_of_range"


def test_size_multiplier_above_cap_rejects() -> None:
    d = evaluate_live_gate(_make_input(size_multiplier=6.0))
    assert d.reason == "size_multiplier_out_of_range"


def test_confidence_below_floor_rejects() -> None:
    d = evaluate_live_gate(_make_input(setup_confidence=0.3))
    assert d.reason == "confidence_below_threshold"


# ── capacity caps ──────────────────────────────────────────────────


def test_per_symbol_cap_exceeded_rejects() -> None:
    d = evaluate_live_gate(_make_input(active_trades_for_symbol=3))
    assert d.reason == "per_symbol_cap_exceeded"


def test_global_cap_exceeded_rejects() -> None:
    d = evaluate_live_gate(_make_input(active_trades_global=20))
    assert d.reason == "global_cap_exceeded"


# ── risk + equity ──────────────────────────────────────────────────


def test_risk_budget_missing_rejects() -> None:
    d = evaluate_live_gate(_make_input(risk=None))
    assert d.reason == "risk_budget_missing"


def test_equity_missing_rejects_as_stale() -> None:
    d = evaluate_live_gate(_make_input(equity=None))
    assert d.reason == "stale_equity_snapshot"


def test_stale_equity_rejects() -> None:
    d = evaluate_live_gate(_make_input(equity_age_seconds=120.0))
    assert d.reason == "stale_equity_snapshot"


def test_daily_drawdown_breached_rejects() -> None:
    # 2.5% drawdown realised + 0.8% pending = 3.3% > 3% cap.
    d = evaluate_live_gate(
        _make_input(
            equity=_equity(realized=-2500.0),
            planned_trade_risk_dollars=800.0,
        )
    )
    assert d.reason == "daily_drawdown_breached"


def test_max_open_positions_breached_rejects() -> None:
    d = evaluate_live_gate(_make_input(open_positions_count=5))
    assert d.reason == "max_open_positions_breached"


def test_gross_exposure_breached_rejects() -> None:
    # Budget 2x, equity 100k, cap 200k. Gross 190k + 15k pending = 205k.
    d = evaluate_live_gate(
        _make_input(
            current_gross_exposure=190_000.0,
            planned_trade_notional=15_000.0,
            risk=_budget(max_gross_exposure=2.0, max_open_positions=10),
            open_positions_count=3,
        )
    )
    assert d.reason == "gross_exposure_breached"


def test_correlation_cap_breached_rejects() -> None:
    # Correlation cap = 0.5x equity (50k), correlated gross 45k + 10k = 55k.
    d = evaluate_live_gate(
        _make_input(
            correlated_gross_exposure=45_000.0,
            current_gross_exposure=45_000.0,
            planned_trade_notional=10_000.0,
            risk=_budget(
                max_correlated_exposure=0.5,
                max_gross_exposure=5.0,
                max_open_positions=10,
            ),
            open_positions_count=2,
        )
    )
    assert d.reason == "correlation_cap_breached"


def test_risk_per_trade_breached_rejects() -> None:
    # $1000 dollar risk / 100k equity = 1% > 0.5% cap.
    d = evaluate_live_gate(_make_input(planned_trade_risk_dollars=1_000.0))
    assert d.reason == "risk_per_trade_breached"


def test_insufficient_buying_power_rejects() -> None:
    d = evaluate_live_gate(
        _make_input(
            equity=_equity(buying_power=5_000.0),
            planned_trade_notional=10_000.0,
            risk=_budget(
                max_risk_per_trade_r=0.1,
                max_daily_drawdown_r=0.5,
                max_gross_exposure=10.0,
                max_correlated_exposure=10.0,
            ),
        )
    )
    assert d.reason == "insufficient_buying_power"


# ── happy path ─────────────────────────────────────────────────────


def test_happy_path_approves() -> None:
    d = evaluate_live_gate(_make_input())
    assert d.approved, d
    assert d.reason == "approved"
    assert d.r_risk is not None
    assert 0.0 < d.r_risk <= 0.005


def test_paper_mode_happy_path_approves_without_broker() -> None:
    d = evaluate_live_gate(
        _make_input(mode="paper", broker_available=False, live_enabled=False)
    )
    assert d.approved, d


# ── preview sizing ─────────────────────────────────────────────────


def test_preview_live_sizing_computes_qty_and_exposures() -> None:
    preview = preview_live_sizing(
        budget=_budget(max_risk_per_trade_r=0.005),
        equity=_equity(total=100_000.0, sod=100_000.0),
        entry_price=100.0,
        stop_loss=99.5,
        size_multiplier=1.0,
        current_gross_exposure=0.0,
        correlated_gross_exposure=0.0,
    )
    # $500 / $0.5 stop = 1000 qty; $100k equity + $100k notional = 1.0 gross.
    assert preview.qty == 1000.0
    assert preview.dollar_risk == 500.0
    assert preview.notional == 100_000.0
    assert preview.r_risk == 0.005
    assert preview.projected_gross == 1.0
    assert preview.drawdown_r == 0.0


def test_preview_live_sizing_scales_with_size_multiplier() -> None:
    preview = preview_live_sizing(
        budget=_budget(max_risk_per_trade_r=0.005),
        equity=_equity(total=100_000.0),
        entry_price=100.0,
        stop_loss=99.5,
        size_multiplier=2.0,
        current_gross_exposure=10_000.0,
        correlated_gross_exposure=0.0,
    )
    # size_multiplier=2 → risk budget 1% → dollar_risk $1000 → qty 2000
    assert preview.qty == 2000.0
    assert preview.dollar_risk == 1_000.0
    assert preview.r_risk == 0.01


def test_preview_live_sizing_surfaces_drawdown_on_losing_day() -> None:
    preview = preview_live_sizing(
        budget=_budget(),
        equity=_equity(
            total=99_000.0, sod=100_000.0, realized=-1_000.0, unrealized=0.0
        ),
        entry_price=100.0,
        stop_loss=99.5,
        size_multiplier=1.0,
        current_gross_exposure=0.0,
        correlated_gross_exposure=0.0,
    )
    assert preview.drawdown_r == 0.01
