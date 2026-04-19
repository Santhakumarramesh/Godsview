"""Unit tests for the pure execution gate.

The gate is a pure predicate — we exercise the full decision matrix
with zero database involvement.
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest

from app.execution import GateInput, evaluate_gate
from app.execution.gate import (
    DEFAULT_MAX_GLOBAL,
    DEFAULT_MAX_PER_SYMBOL,
    DEFAULT_MAX_SIZE_MULTIPLIER,
    DEFAULT_MIN_CONFIDENCE,
)

UTC = timezone.utc
_NOW = datetime(2026, 4, 19, 12, 0, 0, tzinfo=UTC)


def _base(**overrides: object) -> GateInput:
    """A fully-valid baseline the tests mutate field-by-field."""

    defaults: dict[str, object] = dict(
        mode="paper",
        size_multiplier=1.0,
        setup_status="detected",
        setup_confidence=0.65,
        setup_expires_at=_NOW + timedelta(minutes=30),
        kill_switch_active=False,
        active_trades_for_symbol=0,
        active_trades_global=0,
        setup_has_active_paper_trade=False,
        now=_NOW,
    )
    defaults.update(overrides)
    return GateInput(**defaults)  # type: ignore[arg-type]


# ─────────────────────────────── happy path ──────────────────────────


def test_baseline_approves() -> None:
    d = evaluate_gate(_base())
    assert d.approved is True
    assert d.reason == "approved"
    assert "passed" in d.detail


# ─────────────────────────── absolute overrides ─────────────────────


def test_kill_switch_beats_everything() -> None:
    # Even with live-mode + bad size + bad status, kill_switch is first.
    d = evaluate_gate(
        _base(
            kill_switch_active=True,
            mode="live",
            size_multiplier=9.9,
            setup_status="closed",
        )
    )
    assert d.approved is False
    assert d.reason == "kill_switch_active"


def test_live_mode_rejected_in_phase_3() -> None:
    d = evaluate_gate(_base(mode="live"))
    assert d.approved is False
    assert d.reason == "live_disallowed"


# ─────────────────────────── setup preconditions ────────────────────


@pytest.mark.parametrize(
    "state",
    ["approved_paper", "approved_live", "filled", "closed", "rejected", "expired"],
)
def test_non_detected_status_is_rejected(state: str) -> None:
    d = evaluate_gate(_base(setup_status=state))
    assert d.approved is False
    assert d.reason == "setup_not_detected"
    assert state in d.detail


def test_expired_setup_is_rejected() -> None:
    d = evaluate_gate(_base(setup_expires_at=_NOW - timedelta(seconds=1)))
    assert d.approved is False
    assert d.reason == "setup_expired"


def test_null_expiry_is_allowed() -> None:
    d = evaluate_gate(_base(setup_expires_at=None))
    assert d.approved is True


def test_naive_expiry_is_treated_as_utc() -> None:
    # A naive datetime a second in the future should still count as
    # valid once the gate normalises it.
    naive = (_NOW + timedelta(seconds=5)).replace(tzinfo=None)
    d = evaluate_gate(_base(setup_expires_at=naive))
    assert d.approved is True


def test_duplicate_active_trade_blocks() -> None:
    d = evaluate_gate(_base(setup_has_active_paper_trade=True))
    assert d.approved is False
    assert d.reason == "duplicate_active_trade"


# ─────────────────────────── sizing ─────────────────────────────────


@pytest.mark.parametrize("sz", [0.0, -0.5, DEFAULT_MAX_SIZE_MULTIPLIER + 0.01])
def test_out_of_range_size_is_rejected(sz: float) -> None:
    d = evaluate_gate(_base(size_multiplier=sz))
    assert d.approved is False
    assert d.reason == "size_multiplier_out_of_range"


def test_size_at_ceiling_is_allowed() -> None:
    d = evaluate_gate(_base(size_multiplier=DEFAULT_MAX_SIZE_MULTIPLIER))
    assert d.approved is True


# ─────────────────────────── confidence ─────────────────────────────


def test_low_confidence_blocks() -> None:
    d = evaluate_gate(_base(setup_confidence=DEFAULT_MIN_CONFIDENCE - 0.01))
    assert d.approved is False
    assert d.reason == "confidence_below_threshold"


def test_exact_threshold_passes() -> None:
    d = evaluate_gate(_base(setup_confidence=DEFAULT_MIN_CONFIDENCE))
    assert d.approved is True


# ─────────────────────────── capacity caps ──────────────────────────


def test_per_symbol_cap_blocks() -> None:
    d = evaluate_gate(_base(active_trades_for_symbol=DEFAULT_MAX_PER_SYMBOL))
    assert d.approved is False
    assert d.reason == "per_symbol_cap_exceeded"


def test_global_cap_blocks() -> None:
    d = evaluate_gate(
        _base(
            active_trades_for_symbol=0,
            active_trades_global=DEFAULT_MAX_GLOBAL,
        )
    )
    assert d.approved is False
    assert d.reason == "global_cap_exceeded"


def test_per_symbol_cap_wins_over_global() -> None:
    # When both caps are exceeded the per-symbol reason wins
    # (more localised, better operator signal).
    d = evaluate_gate(
        _base(
            active_trades_for_symbol=DEFAULT_MAX_PER_SYMBOL + 5,
            active_trades_global=DEFAULT_MAX_GLOBAL + 5,
        )
    )
    assert d.reason == "per_symbol_cap_exceeded"


# ─────────────────────────── ordering ───────────────────────────────


def test_rejection_order_kill_switch_before_live() -> None:
    # both absolute — kill_switch wins
    d = evaluate_gate(_base(kill_switch_active=True, mode="live"))
    assert d.reason == "kill_switch_active"


def test_rejection_order_setup_state_before_size() -> None:
    d = evaluate_gate(_base(setup_status="closed", size_multiplier=99.0))
    assert d.reason == "setup_not_detected"


def test_rejection_order_size_before_confidence() -> None:
    d = evaluate_gate(_base(size_multiplier=99.0, setup_confidence=0.0))
    assert d.reason == "size_multiplier_out_of_range"


def test_rejection_order_confidence_before_caps() -> None:
    d = evaluate_gate(
        _base(
            setup_confidence=0.0,
            active_trades_for_symbol=99,
            active_trades_global=99,
        )
    )
    assert d.reason == "confidence_below_threshold"
